import { NonRetriableError, startOfflineExecutor } from '@tanstack/offline-transactions'
import type { PendingMutation } from '@tanstack/db'
import {
  CollectionNameSchema,
  type CollectionName,
  type Mutation,
  type MutationRequest,
  type StateResponse,
} from '@thai/schema'
import { ApiClientError, pushMutations } from './api.ts'
import {
  STATE_QUERY_KEY,
  clarifications,
  mergeRows,
  preloadState,
  translations,
} from './collections.ts'
import { queryClient } from './queryClient.ts'

/** The name the outbox persists alongside each entry, so it survives a reload. */
const PUSH = 'push'

/**
 * Durable write path.
 *
 * Every mutation is written to an IndexedDB outbox *before* it is sent, so a
 * write made offline — or one interrupted by a closed tab — is replayed on
 * reconnect rather than lost. Entries drain FIFO with exponential backoff.
 *
 * Only the leader tab owns the outbox; other tabs stay online-only. That is a
 * real behavioural difference, so it is surfaced in the UI rather than hidden.
 */
export const offline = startOfflineExecutor({
  collections: { translations, clarifications },
  mutationFns: {
    [PUSH]: async ({ transaction, idempotencyKey }) => {
      const request: MutationRequest = {
        idempotencyKey,
        mutations: transaction.mutations.map(toWireMutation),
      }

      try {
        const response = await pushMutations(request)
        // Fold the server's confirmed rows straight into the cache the
        // collections read from, so the optimistic row is replaced by the real
        // one without waiting for the next poll.
        applyServerRows(response)
      } catch (error) {
        // A 4xx will never succeed on retry. Marking it non-retriable is what
        // stops a permanently-invalid mutation from occupying the head of a
        // FIFO outbox forever and blocking every write behind it.
        if (error instanceof ApiClientError && error.status < 500) {
          throw new NonRetriableError(error.message)
        }
        throw error
      }
    },
  },
})

function toWireMutation(mutation: PendingMutation): Mutation {
  const collection = collectionNameOf(mutation)
  const key = String(mutation.key)

  if (mutation.type === 'insert') {
    return { type: 'insert', collection, key, modified: mutation.modified }
  }
  if (mutation.type === 'update') {
    return {
      type: 'update',
      collection,
      key,
      changes: mutation.changes as Record<string, unknown>,
    }
  }
  return { type: 'delete', collection, key }
}

function collectionNameOf(mutation: PendingMutation): CollectionName {
  const parsed = CollectionNameSchema.safeParse(mutation.collection.id)
  if (!parsed.success) {
    // Non-retriable: an unknown collection id is a bug, not a transient fault,
    // and retrying it would wedge the outbox.
    throw new NonRetriableError(`unknown collection ${String(mutation.collection.id)}`)
  }
  return parsed.data
}

/**
 * Merges confirmed rows into the shared state cache.
 *
 * Deliberately does *not* advance `now`: these rows came from a write, not from
 * a read of the whole partition, so the sync watermark must stay where the last
 * `GET /api/state` left it or changes from other devices would be skipped.
 */
function applyServerRows(response: StateResponse): void {
  queryClient.setQueryData<StateResponse>(STATE_QUERY_KEY, (previous) => {
    const base: StateResponse = previous ?? { translations: [], clarifications: [], now: 0 }
    return {
      translations: mergeRows(base.translations, response.translations),
      clarifications: mergeRows(base.clarifications, response.clarifications),
      now: base.now,
    }
  })
}

/**
 * What every route loader awaits: the collections are warm *and* the outbox has
 * been read back off disk.
 *
 * The second half matters as much as the first. A write made offline lives only
 * in the outbox until it is sent, and the executor replays it into the
 * collections as optimistic state during init. Rendering before that finishes
 * shows the user a list with their own unsent change missing from it.
 */
export async function hydrate(): Promise<void> {
  await Promise.all([preloadState(), offline.waitForInit().catch(noop)])
}

function noop() {}

type WriteErrorListener = (error: Error) => void

const writeErrorListeners = new Set<WriteErrorListener>()

/**
 * Subscribes to permanently-failed writes. By the time a listener runs, the
 * optimistic state has already rolled back — there is nothing to undo, only
 * something to tell the user.
 */
export function onWriteError(listener: WriteErrorListener): () => void {
  writeErrorListeners.add(listener)
  return () => writeErrorListeners.delete(listener)
}

/**
 * Wraps a set of collection writes in one durable transaction.
 *
 * This is the app's only write path — `actions.ts` is built on it, and nothing
 * else calls `collection.insert/update/delete` directly.
 *
 * Deliberately returns void rather than the commit promise. The optimistic
 * state is applied synchronously, but the commit only settles once the server
 * confirms — which, offline, is *not until the network returns*. A caller that
 * awaited it would sit disabled behind a spinner for as long as the user stays
 * offline, when in fact their change is already saved and on screen. Failures
 * come back through `onWriteError` instead.
 */
export function mutate(apply: () => void): void {
  const transaction = offline.createOfflineTransaction({
    mutationFnName: PUSH,
    autoCommit: false,
  })
  transaction.mutate(apply)

  void transaction.commit().catch((error: unknown) => {
    const normalized = error instanceof Error ? error : new Error(String(error))
    for (const listener of writeErrorListeners) listener(normalized)
  })
}
