import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import {
  MutationRequestSchema,
  type CollectionName,
  type StateResponse,
} from '@thai/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { getUserId } from './auth.ts'
import { AWS_REGION, env } from './env.ts'
import { InvalidMutationError, type Row } from './normalize.ts'
import { applyMutations, readSince } from './store.ts'
import { syncWatermark } from './keys.ts'
import type { WorkerEvent } from './worker.ts'

const lambda = new LambdaClient({ region: AWS_REGION })

export const app = new Hono()

app.get('/api/health', (c) => c.json({ ok: true }))

/**
 * Everything that changed since `since`. The client keeps the previous
 * response and merges, because a TanStack DB query collection treats what its
 * `queryFn` returns as the collection's complete state.
 */
app.get('/api/state', async (c) => {
  const since = Number(c.req.query('since') ?? 0)
  if (!Number.isFinite(since) || since < 0) {
    return c.json({ error: 'since must be a non-negative timestamp' }, 400)
  }

  return c.json(await readSince(getUserId(c), since))
})

/**
 * The app's only write endpoint. Server-side work is not requested — it is
 * *derived* from the state the batch produces, so the client's write path is
 * identical whether or not a mutation happens to need the model.
 */
app.post('/api/mutations', async (c) => {
  const userId = getUserId(c)

  const body: unknown = await c.req.json().catch(() => undefined)
  const parsed = MutationRequestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: z.prettifyError(parsed.error) }, 400)
  }

  let result
  try {
    result = await applyMutations(userId, parsed.data)
  } catch (error) {
    // A malformed mutation will never succeed, so it must come back as a 4xx:
    // the client turns that into a NonRetriableError and drops it from the
    // outbox rather than retrying it forever.
    if (error instanceof InvalidMutationError) {
      return c.json({ error: error.message }, 400)
    }
    throw error
  }

  if (!result.replayed) {
    await dispatchPending(userId, result.rows)
  }

  return c.json(toStateResponse(result.rows))
})

/**
 * Kicks off the model for every row that came to rest in `pending`.
 *
 * Failing to dispatch is logged, not surfaced: the write itself is committed,
 * and a row left pending is recoverable from the UI's Retry. Failing the
 * response here would make the client retry the whole batch instead.
 */
async function dispatchPending(
  userId: string,
  rows: Array<{ collection: CollectionName; row: Row }>,
): Promise<void> {
  const pending = rows.filter(({ row }) => row.status === 'pending' && !row.deleted)

  await Promise.all(
    pending.map(async ({ collection, row }) => {
      const event: WorkerEvent = { userId, collection, id: row.id }
      try {
        await lambda.send(
          new InvokeCommand({
            FunctionName: env.workerFunctionName,
            InvocationType: 'Event',
            Payload: Buffer.from(JSON.stringify(event)),
          }),
        )
      } catch (error) {
        console.error('failed to dispatch worker', collection, row.id, error)
      }
    }),
  )
}

function toStateResponse(rows: Array<{ collection: CollectionName; row: Row }>): StateResponse {
  return {
    translations: rows.flatMap(({ collection, row }) =>
      collection === 'translations' ? [row] : [],
    ) as StateResponse['translations'],
    clarifications: rows.flatMap(({ collection, row }) =>
      collection === 'clarifications' ? [row] : [],
    ) as StateResponse['clarifications'],
    now: syncWatermark(),
  }
}
