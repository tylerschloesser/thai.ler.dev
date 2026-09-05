import * as route53 from 'aws-cdk-lib/aws-route53'
import type { Construct } from 'constructs'

export const DOMAIN = 'thai.ler.dev'

export const ZONE = {
  hostedZoneId: 'Z0635906RMEZ6PGB3D6I',
  zoneName: 'ler.dev',
}

export function hostedZone(scope: Construct): route53.IHostedZone {
  return route53.HostedZone.fromHostedZoneAttributes(scope, 'Zone', ZONE)
}

export const CERT_EXPORT = 'ThaiLerDev:CertificateArn'
export const API_URL_EXPORT = 'ThaiLerDev:ApiFunctionUrl'
export const API_ARN_EXPORT = 'ThaiLerDev:ApiFunctionArn'

export function previewDomain(pr: number) {
  return `pr-${pr}.${DOMAIN}`
}

export function previewRecordName(pr: number) {
  return `pr-${pr}.thai`
}
