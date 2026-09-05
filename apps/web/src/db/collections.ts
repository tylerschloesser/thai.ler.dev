import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import {
  ClarificationSchema,
  TranslationSchema,
  type Clarification,
  type StateResponse,
  type Translation,
} from '@thai/schema'
import { fetchState } from './api.ts'
import { queryClient } from './queryClient.ts'

/**
 * Both collections are fed by one query, so a single request fills both and
 * they can never be inconsistent with each other.
 */
export const STATE_QUERY_KEY = ['state'] as const

const EMPTY: StateResponse = { translations: [], clarifications: [], now: 0 }

/**
 * A query collection treats whatever `queryFn` returns as the collection's
 * *complete* state — anything absent is deleted. The server only ever sends a
 * delta, so the delta is merged onto the previous response here, and the merged
 * whole is what gets returned (and cached, and persisted).
 */
async function fetchMergedState(context: { signal: AbortSignal }): Promise<StateResponse> {
  const previous = queryClient.getQueryData<StateResponse>(STATE_QUERY_KEY) ?? EMPTY
  const delta = await fetchState(previous.now, context.signal)

  return {
    translations: mergeRows(previous.translations, delta.translations),
    clarifications: mergeRows(previous.clarifications, delta.clarifications),
    now: delta.now,
  }
}

/**
 * Last-write-wins on `updatedAt`, with tombstones dropped on the way out so a
 * deleted row disappears from the collection rather than lingering as a
 * `deleted: true` row every consumer would have to filter.
 *
 * Exported because the write path merges confirmed rows into the same cache and
 * must do it identically — a second, subtly different merge is how a deleted
 * row comes back from the dead.
 */
export function mergeRows<T extends { id: string; updatedAt: number; deleted: boolean }>(
  previous: T[],
  incoming: T[],
): T[] {
  const merged = new Map(previous.map((row) => [row.id, row]))

  for (const row of incoming) {
    const existing = merged.get(row.id)
    if (!existing || row.updatedAt >= existing.updatedAt) {
      merged.set(row.id, row)
    }
  }

  return [...merged.values()].filter((row) => !row.deleted)
}

/**
 * Writes never go through these handlers. The app's only write path is the
 * offline executor in `sync.ts`, which owns durability and retries; wiring
 * `onInsert`/`onUpdate`/`onDelete` here as well would give it a second,
 * non-durable one.
 */
export const translations = createCollection(
  queryCollectionOptions({
    id: 'translations',
    queryKey: STATE_QUERY_KEY,
    queryFn: fetchMergedState,
    select: (data) => data.translations,
    getKey: (row: Translation) => row.id,
    schema: TranslationSchema,
    queryClient,
  }),
)

export const clarifications = createCollection(
  queryCollectionOptions({
    id: 'clarifications',
    queryKey: STATE_QUERY_KEY,
    queryFn: fetchMergedState,
    select: (data) => data.clarifications,
    getKey: (row: Clarification) => row.id,
    schema: ClarificationSchema,
    queryClient,
  }),
)

/**
 * Warms both collections before a route renders, so it never mounts into an
 * empty collection and then pops.
 *
 * Failure is deliberately swallowed. This is an optimization, not a correctness
 * gate: offline, the fetch behind it always fails, but the persisted cache
 * usually still has everything worth showing — letting that reject would turn a
 * working offline page into a full-screen "Failed to fetch". Genuine load
 * failures still surface, through the collection's own `isError` state, next to
 * the data they concern.
 */
export async function preloadState(): Promise<void> {
  await Promise.all([
    translations.preload().catch(noop),
    clarifications.preload().catch(noop),
  ])
}

function noop() {}
