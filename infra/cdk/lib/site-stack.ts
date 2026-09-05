import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CfnOutput, Fn, RemovalPolicy, Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import type { Construct } from 'constructs'
import { Api } from './api.js'
import { API_ARN_EXPORT, API_URL_EXPORT, CERT_EXPORT, DOMAIN, hostedZone } from './dns.js'
import { addSite } from './site.js'

export class SiteStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props)

    const currentDir = dirname(fileURLToPath(import.meta.url))
    const webDist = join(currentDir, '../../../apps/web/dist')

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'Certificate',
      Fn.importValue(CERT_EXPORT),
    )

    // Prod still holds the API and the site in one stack, but not because of
    // a cycle any more: `addSite` takes an `IFunctionUrl`, and
    // `FunctionUrlOrigin.withOriginAccessControl` writes its invoke
    // permission in the distribution's own scope, so a preview stack can
    // point at prod's exported function URL without one. The exports below
    // are explicit because `cdk.json` sets
    // `@aws-cdk/core:defaultCrossStackReferences` to `"weak"`.
    const api = new Api(this, 'Api', { removalPolicy: RemovalPolicy.RETAIN, pointInTimeRecovery: true })

    const { distribution, bucket } = addSite(this, {
      domainName: DOMAIN,
      recordName: 'thai',
      zone: hostedZone(this),
      certificate,
      apiFunctionUrl: api.functionUrl,
      webDist,
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
    new CfnOutput(this, 'ApiFunctionUrl', {
      value: api.functionUrl.url,
      exportName: API_URL_EXPORT,
    })
    new CfnOutput(this, 'ApiFunctionArn', {
      value: api.handler.functionArn,
      exportName: API_ARN_EXPORT,
    })
  }
}
