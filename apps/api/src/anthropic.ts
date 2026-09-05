import Anthropic from '@anthropic-ai/sdk'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { AWS_REGION, env } from './env.ts'

/** Leaves room inside the worker's 10 minute Lambda timeout to record a failure. */
const REQUEST_TIMEOUT_MS = 9 * 60 * 1000

let cached: Promise<Anthropic> | undefined

/**
 * The key lives in Secrets Manager and is fetched once per cold start — never
 * a plaintext env var, which would put it in the CloudFormation template.
 */
export function anthropic(): Promise<Anthropic> {
  cached ??= create()
  return cached
}

async function create(): Promise<Anthropic> {
  const secrets = new SecretsManagerClient({ region: AWS_REGION })
  const result = await secrets.send(
    new GetSecretValueCommand({ SecretId: env.anthropicSecretArn }),
  )
  const raw = result.SecretString
  if (!raw) throw new Error('anthropic secret has no string value')

  return new Anthropic({ apiKey: extractApiKey(raw), timeout: REQUEST_TIMEOUT_MS })
}

/** Accepts either a bare key or the `{"apiKey": "..."}` shape the console produces. */
function extractApiKey(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return trimmed

  const parsed: unknown = JSON.parse(trimmed)
  if (parsed && typeof parsed === 'object') {
    const value = (parsed as Record<string, unknown>).apiKey
    if (typeof value === 'string' && value) return value
  }
  throw new Error('anthropic secret JSON has no apiKey field')
}
