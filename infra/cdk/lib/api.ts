import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Duration, RemovalPolicy } from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { Construct } from 'constructs'

/**
 * Secrets Manager secret holding the Anthropic API key, created out of band so
 * the key never appears in this repo or in a CloudFormation template:
 *
 *   AWS_PROFILE=admin aws secretsmanager create-secret \
 *     --name thai-ler-dev/anthropic --secret-string 'sk-ant-...'
 */
const ANTHROPIC_SECRET_NAME = 'thai-ler-dev/anthropic'

const apiSrc = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/api/src')

const commonFunctionProps = {
  runtime: lambda.Runtime.NODEJS_22_X,
  architecture: lambda.Architecture.ARM_64,
  handler: 'handler',
  bundling: {
    target: 'node22',
    // The Node 22 runtime ships AWS SDK v3; bundling a second copy would cost
    // megabytes of cold start for no benefit.
    externalModules: ['@aws-sdk/*'],
    sourceMap: true,
  },
} satisfies Partial<nodejs.NodejsFunctionProps>

/** Makes the bundled source maps show up in stack traces. */
const SOURCE_MAPS = { NODE_OPTIONS: '--enable-source-maps' }

/**
 * The whole backend: one table, one request-path function, one worker.
 *
 * Deliberately no API Gateway. The function is reached through a Lambda
 * function URL behind the site's existing CloudFront distribution, which means
 * no per-request charge at idle and — because `/api/*` is same-origin — no CORS
 * and no preflight on any mutation.
 */
export class Api extends Construct {
  readonly table: dynamodb.TableV2
  readonly functionUrl: lambda.FunctionUrl
  /** Exposed so the stack can grant CloudFront the second invoke permission. */
  readonly handler: nodejs.NodejsFunction

  constructor(scope: Construct, id: string) {
    super(scope, id)

    this.table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      // Sparse LSI over `<padded updatedAt>#<collection>#<id>`, so one Query
      // answers "everything that changed since T" for a user. Idempotency
      // records carry no `sk2` and so stay out of it.
      localSecondaryIndexes: [
        {
          indexName: 'by-updated',
          sortKey: { name: 'sk2', type: dynamodb.AttributeType.STRING },
          projectionType: dynamodb.ProjectionType.ALL,
        },
      ],
      timeToLiveAttribute: 'expiresAt',
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    })

    const anthropicSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'AnthropicSecret',
      ANTHROPIC_SECRET_NAME,
    )

    // Nothing waits on the worker, so it gets room for a long model call.
    const worker = new nodejs.NodejsFunction(this, 'Worker', {
      ...commonFunctionProps,
      entry: join(apiSrc, 'worker.ts'),
      memorySize: 1024,
      timeout: Duration.minutes(10),
      retryAttempts: 2,
      environment: {
        ...SOURCE_MAPS,
        TABLE_NAME: this.table.tableName,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
      },
    })

    const api = (this.handler = new nodejs.NodejsFunction(this, 'Function', {
      ...commonFunctionProps,
      entry: join(apiSrc, 'lambda.ts'),
      memorySize: 512,
      timeout: Duration.seconds(30),
      environment: {
        ...SOURCE_MAPS,
        TABLE_NAME: this.table.tableName,
        WORKER_FUNCTION_NAME: worker.functionName,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
      },
    }))

    this.table.grantReadWriteData(api)
    this.table.grantReadWriteData(worker)
    worker.grantInvoke(api)
    anthropicSecret.grantRead(worker)

    // AWS_IAM, not NONE: the only caller is CloudFront's origin access control,
    // which signs each origin request with SigV4. Hitting the function URL
    // directly returns 403.
    this.functionUrl = api.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    })
  }
}
