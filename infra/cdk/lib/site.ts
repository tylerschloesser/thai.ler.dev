import { existsSync } from 'node:fs'
import { Duration, RemovalPolicy } from 'aws-cdk-lib'
import type { Stack } from 'aws-cdk-lib'
import type * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as targets from 'aws-cdk-lib/aws-route53-targets'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'

export interface SiteProps {
  readonly domainName: string
  readonly recordName: string
  readonly zone: route53.IHostedZone
  readonly certificate: acm.ICertificate
  readonly apiFunctionUrl: lambda.IFunctionUrl
  readonly webDist: string
}

export function addSite(
  scope: Stack,
  props: SiteProps,
): { distribution: cloudfront.Distribution; bucket: s3.Bucket } {
  // Here rather than in the caller, so a preview stack cannot skip the check
  // and synth an empty bucket deployment.
  if (!existsSync(props.webDist)) {
    throw new Error(
      'apps/web/dist not found — run `pnpm --filter web build` first',
    )
  }

  const bucket = new s3.Bucket(scope, 'SiteBucket', {
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    removalPolicy: RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
  })

  // Client-side routes are rewritten to index.html here rather than through
  // distribution-wide `errorResponses`, because those apply to *every*
  // behavior — a 403 or 404 from `/api/*` would come back as the HTML shell
  // with status 200. This is scoped to the default behavior, and only
  // rewrites extensionless paths, so a genuinely missing asset still 404s
  // instead of silently returning HTML.
  const spaFallback = new cloudfront.Function(scope, 'SpaFallback', {
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

  const distribution = new cloudfront.Distribution(scope, 'Distribution', {
    additionalBehaviors: {
      '/api/*': {
        origin: origins.FunctionUrlOrigin.withOriginAccessControl(props.apiFunctionUrl),
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
    domainNames: [props.domainName],
    certificate: props.certificate,
    defaultRootObject: 'index.html',
    minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    enableIpv6: true,
  })

  const source = s3deploy.Source.asset(props.webDist)

  /**
   * Files whose names are stable across builds, so they can never be cached
   * hard. `sw.js` especially: a service worker pinned at the edge for a year
   * would keep serving an old app shell from every visitor's cache long after
   * a deploy, and it is the one file that can outlive its own replacement.
   */
  const UNVERSIONED = ['*.html', 'sw.js', 'manifest.webmanifest', 'registerSW.js']

  const deployAssets = new s3deploy.BucketDeployment(scope, 'DeployAssets', {
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

  const deployHtml = new s3deploy.BucketDeployment(scope, 'DeployHtml', {
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
  //
  // This is a `CfnPermission` rather than `handler.addPermission` because the
  // logical id has to move out of the function's own scope: a preview stack
  // points at an imported function ARN, not a `Function` construct, so there
  // is no `handler` to attach the permission to here.
  new lambda.CfnPermission(scope, 'AllowCloudFrontInvokeFunction', {
    action: 'lambda:InvokeFunction',
    principal: 'cloudfront.amazonaws.com',
    functionName: props.apiFunctionUrl.functionArn,
    sourceArn: `arn:aws:cloudfront::${scope.account}:distribution/${distribution.distributionId}`,
  })

  const target = route53.RecordTarget.fromAlias(
    new targets.CloudFrontTarget(distribution),
  )

  new route53.ARecord(scope, 'ARecord', {
    recordName: props.recordName,
    zone: props.zone,
    target,
  })

  new route53.AaaaRecord(scope, 'AaaaRecord', {
    recordName: props.recordName,
    zone: props.zone,
    target,
  })

  return { distribution, bucket }
}
