import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  BreakdownSchema,
  ClarificationAnswerSchema,
  type Clarification,
  type CollectionName,
  type Translation,
} from '@thai/schema'
import { anthropic } from './anthropic.ts'
import {
  BREAKDOWN_SYSTEM,
  CLARIFICATION_SYSTEM,
  breakdownPrompt,
  clarificationPrompt,
} from './prompts.ts'
import { getRow, putRow } from './store.ts'

const MODEL = 'claude-opus-5'
const MAX_TOKENS = 32000

export type WorkerEvent = {
  userId: string
  collection: CollectionName
  id: string
}

/**
 * Fulfils one row that is sitting in `status: 'pending'`.
 *
 * Invoked asynchronously, so nothing is waiting on it and it can take minutes.
 * It re-reads the row first and exits quietly unless the row is still pending,
 * which makes it safe to invoke more than once — Lambda's async retries, a
 * duplicate mutation, and a user-pressed Retry all land on the same path.
 */
export async function handler(event: WorkerEvent): Promise<void> {
  const row = await getRow(event.userId, event.collection, event.id)
  if (!row || row.deleted || row.status !== 'pending') {
    console.info('nothing to do', event.collection, event.id, row?.status ?? 'missing')
    return
  }

  try {
    if (event.collection === 'translations') {
      await runBreakdown(event.userId, row as Translation)
    } else {
      await runClarification(event.userId, row as Clarification)
    }
  } catch (error) {
    console.error('worker failed', event.collection, event.id, error)
    await recordFailure(event, messageOf(error))
  }
}

async function runBreakdown(userId: string, translation: Translation): Promise<void> {
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

  await putRow(userId, 'translations', {
    ...translation,
    status: 'ready',
    lines: breakdown.lines,
    summary: breakdown.summary,
    error: null,
    updatedAt: Date.now(),
  })
}

async function runClarification(userId: string, clarification: Clarification): Promise<void> {
  const parent = await getRow(userId, 'translations', clarification.translationId)
  if (!parent || parent.deleted) {
    throw new Error('the translation this question refers to no longer exists')
  }
  if (parent.status !== 'ready') {
    throw new Error('the translation is not finished yet — ask again once it is')
  }

  const client = await anthropic()
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    system: CLARIFICATION_SYSTEM,
    output_config: { format: zodOutputFormat(ClarificationAnswerSchema) },
    messages: [
      { role: 'user', content: clarificationPrompt(clarification, parent as Translation) },
    ],
  })

  const result = response.parsed_output
  if (!result) throw new Error('model returned no parseable answer')

  await putRow(userId, 'clarifications', {
    ...clarification,
    status: 'ready',
    answer: result.answer,
    error: null,
    updatedAt: Date.now(),
  })
}

/**
 * Re-reads before writing so a row the user deleted (or already retried) while
 * the model was running does not get resurrected as a failure.
 */
async function recordFailure(event: WorkerEvent, error: string): Promise<void> {
  const current = await getRow(event.userId, event.collection, event.id)
  if (!current || current.deleted || current.status !== 'pending') return

  await putRow(event.userId, event.collection, {
    ...current,
    status: 'failed',
    error,
    updatedAt: Date.now(),
  })
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
