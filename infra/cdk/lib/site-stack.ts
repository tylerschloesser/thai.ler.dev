import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as targets from 'aws-cdk-lib/aws-route53-targets'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import type { Construct } from 'constructs'
import { Api } from './api.js'

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

    // The API lives in this stack rather than its own: attaching the function
    // URL origin adds a resource policy scoped to the distribution's ARN, and
    // the distribution needs the origin — a split would be a dependency cycle.
    const api = new Api(this, 'Api')

    // Client-side routes are rewritten to index.html here rather than through
    // distribution-wide `errorResponses`, because those apply to *every*
    // behavior — a 403 or 404 from `/api/*` would come back as the HTML shell
    // with status 200. This is scoped to the default behavior, and only
    // rewrites extensionless paths, so a genuinely missing asset still 404s
    // instead of silently returning HTML.
    const spaFallback = new cloudfront.Function(this, 'SpaFallback', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request
  var uri = request.uri
  if (uri.indexOf('.') === -1) {
    request.uri = '/index.html'
  }
  return request
}
`),
    })

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      additionalBehaviors: {
        '/api/*': {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(api.functionUrl),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Must exclude `host` and *only* `host`.
          //
          // Origin access control signs each origin request with SigV4 over the
          // Lambda function URL's hostname, so forwarding the viewer's
          // `thai.ler.dev` would invalidate the signature. But the deny list is
          // applied to the final outbound header set — which by then includes
          // the `Authorization` header OAC itself just added. Denying
          // `authorization` here strips CloudFront's own signature and the
          // function URL answers 403 without ever invoking the function.
          //
          // That is also why a viewer's auth token cannot ride in
          // `Authorization` at all, and travels in `x-id-token` instead
          // (see apps/api/src/auth.ts).
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          compress: true,
        },
      },
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations: [
          {
            function: spaFallback,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      domainNames: [DOMAIN],
      certificate,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enableIpv6: true,
    })

    const source = s3deploy.Source.asset(webDist)

    /**
     * Files whose names are stable across builds, so they can never be cached
     * hard. `sw.js` especially: a service worker pinned at the edge for a year
     * would keep serving an old app shell from every visitor's cache long after
     * a deploy, and it is the one file that can outlive its own replacement.
     */
    const UNVERSIONED = ['*.html', 'sw.js', 'manifest.webmanifest', 'registerSW.js']

    const deployAssets = new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [source],
      destinationBucket: bucket,
      exclude: UNVERSIONED,
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
      include: UNVERSIONED,
      prune: false,
      cacheControl: [s3deploy.CacheControl.noCache()],
      distribution,
      distributionPaths: ['/*'],
    })

    deployHtml.node.addDependency(deployAssets)

    // `FunctionUrlOrigin.withOriginAccessControl` grants only
    // `lambda:InvokeFunctionUrl`. Since around October 2025 Lambda also requires
    // `lambda:InvokeFunction` on new function URLs, and without it every request
    // through CloudFront is answered 403 by the function URL's auth layer —
    // before the function is ever invoked, so nothing appears in its logs.
    // See aws/aws-cdk#35872.
    api.handler.addPermission('AllowCloudFrontInvokeFunction', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
    })

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
    new CfnOutput(this, 'TableName', { value: api.table.tableName })
  }
}
