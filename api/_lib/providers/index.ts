import type { RunProvider } from '../../../src/lib/records.js'
import type { LineProvider } from '../../../src/llm/provider.js'
import type { RequestContext } from '../context.js'
import { createAnthropicProvider } from './anthropic.js'
import { createFakeProvider } from './fake.js'

/**
 * Thrown when a job's provider is `'anthropic'` but no
 * `ANTHROPIC_API_KEY` is configured. The runner treats this as a
 * step-level failure (`run.lastError`), never a per-line one (PLAN.MD
 * §4.2's "M1 adds" providers note).
 */
export class MissingApiKeyError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not set')
    this.name = 'MissingApiKeyError'
  }
}

/**
 * The provider for a *new* job (PLAN.MD §5 M1): the test-mode `thai_model`
 * cookie if set, else the env default. Once a job exists, the runner always
 * rebuilds the provider from the persisted `run.provider` instead (so a hop
 * or a resume keeps using the same provider regardless of the current
 * request's cookies).
 */
export function selectNewJobProvider(ctx: RequestContext): RunProvider {
  return ctx.modelOverride ?? ctx.env.MODEL_PROVIDER
}

export interface CreateProviderOptions {
  fakeError: string | null
  fakeDelayMs: number | null
}

export function createProvider(
  name: RunProvider,
  opts: CreateProviderOptions,
): LineProvider {
  if (name === 'anthropic') {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) throw new MissingApiKeyError()
    return createAnthropicProvider(apiKey)
  }
  return createFakeProvider({
    provider: name,
    delayMs: opts.fakeDelayMs,
    errorKind: opts.fakeError,
  })
}
