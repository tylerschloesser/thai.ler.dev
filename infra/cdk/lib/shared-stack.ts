import { CfnOutput, Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import type { Construct } from 'constructs'
import { CERT_EXPORT, DOMAIN, hostedZone } from './dns.js'

// A wildcard certificate that both the prod SiteStack and every per-PR
// preview stack import, so it is created once here rather than per-stack.
// Cross-stack references are explicit CfnOutput/Fn.importValue rather than
// CDK's automatic exports, because cdk.json sets
// `@aws-cdk/core:defaultCrossStackReferences` to `"weak"`.
export class SharedStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props)

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: DOMAIN,
      subjectAlternativeNames: ['*.thai.ler.dev'],
      validation: acm.CertificateValidation.fromDns(hostedZone(this)),
    })

    new CfnOutput(this, 'CertificateArn', {
      value: certificate.certificateArn,
      exportName: CERT_EXPORT,
    })
  }
}
