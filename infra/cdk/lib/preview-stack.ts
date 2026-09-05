import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CfnOutput, Fn, RemovalPolicy, Stack, Tags } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import type * as lambda from 'aws-cdk-lib/aws-lambda'
import type { Construct } from 'constructs'
import { Api } from './api.js'
import { API_ARN_EXPORT, API_URL_EXPORT, CERT_EXPORT, hostedZone, previewDomain, previewRecordName } from './dns.js'
import { ImportedFunctionUrl } from './imported-function-url.js'
import { addSite } from './site.js'

export interface PreviewStackProps extends StackProps {
  readonly pr: number
  readonly mode: 'frontend' | 'full-stack'
  readonly modelProvider?: string
}

/**
 * A per-PR preview, serving `pr-<n>.thai.ler.dev`.
 *
 * `frontend` mode deploys no API of its own: `/api/*` is pointed at the
 * *production* function URL through the exports `SiteStack` publishes, via
 * `ImportedFunctionUrl`. That means a frontend preview reads and writes
 * production data — deliberate, and called out in the PR comment that links
 * the preview, so nobody mistakes it for an isolated sandbox.
 *
 * `full-stack` mode deploys its own throwaway `Api` (`RemovalPolicy.DESTROY`,
 * no point-in-time recovery) so the preview is fully isolated, optionally
 * running the fake model via `modelProvider`.
 */
export class PreviewStack extends Stack {
  constructor(scope: Construct, id: string, props: PreviewStackProps) {
    super(scope, id, props)

    const webDist = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/dist')

    let apiFunctionUrl: lambda.IFunctionUrl

    if (props.mode === 'full-stack') {
      const api = new Api(this, 'Api', {
        removalPolicy: RemovalPolicy.DESTROY,
        pointInTimeRecovery: false,
        modelProvider: props.modelProvider,
      })
      new CfnOutput(this, 'TableName', { value: api.table.tableName })
      apiFunctionUrl = api.functionUrl
    } else {
      // Points this preview's `/api/*` at the *production* API, so a
      // frontend-only preview reads and writes production data. Deliberate —
      // see the module doc comment above, and the PR comment links to it.
      apiFunctionUrl = new ImportedFunctionUrl(this, 'ProdApiUrl', {
        url: Fn.importValue(API_URL_EXPORT),
        functionArn: Fn.importValue(API_ARN_EXPORT),
      })
    }

    const { distribution } = addSite(this, {
      domainName: previewDomain(props.pr),
      recordName: previewRecordName(props.pr),
      zone: hostedZone(this),
      certificate: acm.Certificate.fromCertificateArn(this, 'Certificate', Fn.importValue(CERT_EXPORT)),
      apiFunctionUrl,
      webDist,
    })

    // A weekly janitor uses this tag to find and tear down abandoned previews.
    Tags.of(this).add('thai-ler-dev:pr', String(props.pr))

    // No `exportName` on any of these: two previews synth side by side and
    // must never collide on an export name.
    new CfnOutput(this, 'SiteUrl', { value: `https://${previewDomain(props.pr)}` })
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId })
    new CfnOutput(this, 'Mode', { value: props.mode })
  }
}
