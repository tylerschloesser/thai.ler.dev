import type { Clarification, CollectionName, Translation } from '@thai/schema'
import { getModel } from './model/index.ts'
import { getStore } from './store/index.ts'

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
  const row = await getStore().getRow(event.userId, event.collection, event.id)
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
  const breakdown = await getModel().breakdown(translation)

  await getStore().putRow(userId, 'translations', {
    ...translation,
    status: 'ready',
    lines: breakdown.lines,
    summary: breakdown.summary,
    error: null,
    updatedAt: Date.now(),
  })
}

async function runClarification(userId: string, clarification: Clarification): Promise<void> {
  const parent = await getStore().getRow(userId, 'translations', clarification.translationId)
  if (!parent || parent.deleted) {
    throw new Error('the translation this question refers to no longer exists')
  }
  if (parent.status !== 'ready') {
    throw new Error('the translation is not finished yet — ask again once it is')
  }

  const result = await getModel().clarify(clarification, parent as Translation)

  await getStore().putRow(userId, 'clarifications', {
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
  const current = await getStore().getRow(event.userId, event.collection, event.id)
  if (!current || current.deleted || current.status !== 'pending') return

  await getStore().putRow(event.userId, event.collection, {
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
