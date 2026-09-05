import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as targets from 'aws-cdk-lib/aws-route53-targets'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import type { Construct } from 'constructs'

const DOMAIN = 'thai.ler.dev'

export class SiteStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props)

    const currentDir = dirname(fileURLToPath(import.meta.url))
    const webDist = join(currentDir, '../../../apps/web/dist')

    if (!existsSync(webDist)) {
      throw new Error(
        'apps/web/dist not found — run `pnpm --filter web build` first',
      )
    }

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: 'Z0635906RMEZ6PGB3D6I',
      zoneName: 'ler.dev',
    })

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: DOMAIN,
      validation: acm.CertificateValidation.fromDns(zone),
    })

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      domainNames: [DOMAIN],
      certificate,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enableIpv6: true,
      errorResponses: [
        {
          httpStatus: 403,
          responsePagePath: '/index.html',
          responseHttpStatus: 200,
          ttl: Duration.minutes(0),
        },
        {
          httpStatus: 404,
          responsePagePath: '/index.html',
          responseHttpStatus: 200,
          ttl: Duration.minutes(0),
        },
      ],
    })

    const source = s3deploy.Source.asset(webDist)

    const deployAssets = new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [source],
      destinationBucket: bucket,
      exclude: ['*.html'],
      prune: true,
      cacheControl: [
        s3deploy.CacheControl.setPublic(),
        s3deploy.CacheControl.maxAge(Duration.days(365)),
        s3deploy.CacheControl.immutable(),
      ],
    })

    const deployHtml = new s3deploy.BucketDeployment(this, 'DeployHtml', {
      sources: [source],
      destinationBucket: bucket,
      exclude: ['*'],
      include: ['*.html'],
      prune: false,
      cacheControl: [s3deploy.CacheControl.noCache()],
      distribution,
      distributionPaths: ['/*'],
    })

    deployHtml.node.addDependency(deployAssets)

    const target = route53.RecordTarget.fromAlias(
      new targets.CloudFrontTarget(distribution),
    )

    new route53.ARecord(this, 'ARecord', {
      recordName: 'thai',
      zone,
      target,
    })

    new route53.AaaaRecord(this, 'AaaaRecord', {
      recordName: 'thai',
      zone,
      target,
    })

    new CfnOutput(this, 'SiteUrl', { value: `https://${DOMAIN}` })
    new CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
    })
    new CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
    })
    new CfnOutput(this, 'BucketName', { value: bucket.bucketName })
  }
}
