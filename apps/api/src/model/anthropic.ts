import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import {
  BreakdownSchema,
  ClarificationAnswerSchema,
  type Breakdown,
  type Clarification,
  type ClarificationAnswer,
  type Translation,
} from '@thai/schema'
import { AWS_REGION, env } from '../env.ts'
import {
  BREAKDOWN_SYSTEM,
  CLARIFICATION_SYSTEM,
  breakdownPrompt,
  clarificationPrompt,
} from '../prompts.ts'
import type { Model } from './index.ts'

const MODEL = 'claude-opus-5'
const MAX_TOKENS = 32000

/** Leaves room inside the worker's 10 minute Lambda timeout to record a failure. */
const REQUEST_TIMEOUT_MS = 9 * 60 * 1000

let cached: Promise<Anthropic> | undefined

/**
 * The key lives in Secrets Manager and is fetched once per cold start — never
 * a plaintext env var, which would put it in the CloudFormation template.
 */
function anthropic(): Promise<Anthropic> {
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

export function createAnthropicModel(): Model {
  return {
    breakdown: (translation) => runBreakdown(translation),
    clarify: (clarification, translation) => runClarification(clarification, translation),
  }
}

async function runBreakdown(translation: Translation): Promise<Breakdown> {
  const client = await anthropic()
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    system: BREAKDOWN_SYSTEM,
    output_config: { format: zodOutputFormat(BreakdownSchema) },
    messages: [{ role: 'user', content: breakdownPrompt(translation) }],
  })

  const breakdown = response.parsed_output
  if (!breakdown) throw new Error('model returned no parseable breakdown')

  return breakdown
}

async function runClarification(
  clarification: Clarification,
  translation: Translation,
): Promise<ClarificationAnswer> {
  const client = await anthropic()
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    system: CLARIFICATION_SYSTEM,
    output_config: { format: zodOutputFormat(ClarificationAnswerSchema) },
    messages: [{ role: 'user', content: clarificationPrompt(clarification, translation) }],
  })

  const result = response.parsed_output
  if (!result) throw new Error('model returned no parseable answer')

  return result
}
