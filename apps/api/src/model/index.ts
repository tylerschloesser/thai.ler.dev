/**
 * The seam every caller goes through to reach the model. The worker gets a
 * real or fake `Model` implementation behind this same interface.
 */

import type { Breakdown, Clarification, ClarificationAnswer, Translation } from '@thai/schema'
import { env } from '../env.ts'
import { createAnthropicModel } from './anthropic.ts'
import { createFakeModel } from './fake.ts'

export interface Model {
  breakdown(translation: Translation): Promise<Breakdown>
  clarify(clarification: Clarification, translation: Translation): Promise<ClarificationAnswer>
}

let cached: Model | undefined

/**
 * Lazy so importing this module constructs no client, and so a test can set
 * MODEL_PROVIDER first. The choice between `anthropic` and `fake` is made
 * once per process, from `env.modelProvider` (set via the `MODEL_PROVIDER`
 * env var).
 */
export function getModel(): Model {
  cached ??=
    env.modelProvider === 'fake'
      ? createFakeModel({ delayMs: env.fakeModelDelayMs })
      : createAnthropicModel()
  return cached
}
