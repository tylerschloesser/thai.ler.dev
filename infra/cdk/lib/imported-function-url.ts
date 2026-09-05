import { Resource } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import type { Construct } from 'constructs'

export interface ImportedFunctionUrlProps {
  readonly url: string
  readonly functionArn: string
}

/**
 * A stand-in for a `lambda.IFunctionUrl` that actually lives in another
 * stack, so a preview stack can point its CloudFront `/api/*` behavior at the
 * production API through CloudFormation exports (`Fn.importValue`) instead of
 * deploying its own copy of the API.
 */
export class ImportedFunctionUrl extends Resource implements lambda.IFunctionUrl {
  readonly url: string
  readonly functionArn: string
  // AWS_IAM because the real function URL is AWS_IAM; FunctionUrlOrigin's OAC
  // helper validates this and throws otherwise.
  readonly authType = lambda.FunctionUrlAuthType.AWS_IAM

  constructor(scope: Construct, id: string, props: ImportedFunctionUrlProps) {
    super(scope, id)
    this.url = props.url
    this.functionArn = props.functionArn
  }

  get urlRef(): lambda.IFunctionUrl['urlRef'] {
    return { functionArn: this.functionArn }
  }

  // `FunctionUrlOrigin.withOriginAccessControl` only ever reads `.url` (via
  // `Fn.select(2, Fn.split('/', url))`), `.functionArn` and `.authType` — it
  // never calls `grantInvokeUrl` — so a `Fn.importValue` token in `url` works
  // fine even though there is no real function URL resource behind it here.
  grantInvokeUrl(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ['lambda:InvokeFunctionUrl'],
      resourceArns: [this.functionArn],
    })
  }
}
