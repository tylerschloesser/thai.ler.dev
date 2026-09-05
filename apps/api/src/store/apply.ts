import {
  ClarificationSchema,
  TranslationSchema,
  type Clarification,
  type CollectionName,
  type Mutation,
  type MutationRequest,
  type StateResponse,
  type Translation,
} from '@thai/schema'
import { sk } from '../keys.ts'
import {
  normalizeDelete,
  normalizeInsert,
  normalizeUpdate,
  type Row,
} from '../normalize.ts'
import type { ResolvedRow, RowRef } from './index.ts'

export function refsToLoad(request: MutationRequest): RowRef[] {
  return request.mutations
    .filter((m): m is Extract<Mutation, { type: 'update' | 'delete' }> => m.type !== 'insert')
    .map((m) => ({ collection: m.collection, id: m.key }))
}

export function resolveMutations(
  request: MutationRequest,
  existing: Map<string, Row>,
  stamp: number,
): ResolvedRow[] {
  const resolved: ResolvedRow[] = []
  for (const mutation of request.mutations) {
    const current = existing.get(sk(mutation.collection, mutation.key))

    if (mutation.type === 'insert') {
      // An insert that already landed (a replayed batch under a *new* key, say)
      // must not clobber server-produced content.
      if (current) continue
      resolved.push({
        collection: mutation.collection,
        row: normalizeInsert(mutation.collection, mutation.key, mutation.modified, stamp),
      })
      continue
    }

    if (!current) {
      // Updating or deleting something the server never saw. Nothing to do,
      // and nothing worth failing the whole batch over.
      continue
    }

    resolved.push({
      collection: mutation.collection,
      row:
        mutation.type === 'update'
          ? normalizeUpdate(mutation.collection, current, mutation.changes, stamp)
          : normalizeDelete(current, stamp),
    })
  }
  return resolved
}

/**
 * Rows are validated on the way out rather than trusted. A row written by an
 * older deploy that no longer matches the schema is dropped with a log instead
 * of failing the whole sync — one bad row must not wedge a client forever.
 */
export function toStateResponse(
  items: Array<{ sk: string; collection: CollectionName; data: Row }>,
  now: number,
): StateResponse {
  const translations: Translation[] = []
  const clarifications: Clarification[] = []

  for (const item of items) {
    if (item.collection === 'translations') {
      const parsed = TranslationSchema.safeParse(item.data)
      if (parsed.success) translations.push(parsed.data)
      else console.error('dropping unparseable translation', item.sk, parsed.error.message)
    } else {
      const parsed = ClarificationSchema.safeParse(item.data)
      if (parsed.success) clarifications.push(parsed.data)
      else console.error('dropping unparseable clarification', item.sk, parsed.error.message)
    }
  }

  return { translations, clarifications, now }
}
