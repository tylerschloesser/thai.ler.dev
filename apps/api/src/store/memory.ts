/**
 * In-memory `Store`. This is what backs `pnpm dev` and the e2e suite when
 * `STORE=memory` — it is per-process and everything in it is lost on
 * restart, which is the point: every run starts from a known, empty state
 * instead of whatever production data a previous session left behind.
 */

import type { CollectionName, MutationRequest, StateResponse } from '@thai/schema'
import { idempotencySk, padTimestamp, sk, syncWatermark, updatedSk } from '../keys.ts'
import type { Row } from '../normalize.ts'
import { refsToLoad, resolveMutations, toStateResponse } from './apply.ts'
import type { ApplyResult, ResolvedRow, RowRef, Store } from './index.ts'

type StoredRow = { collection: CollectionName; sk2: string; data: Row }

type UserData = {
  rows: Map<string, StoredRow>
  idempotency: Map<string, RowRef[]>
}

function getUserData(users: Map<string, UserData>, userId: string): UserData {
  let data = users.get(userId)
  if (!data) {
    data = { rows: new Map(), idempotency: new Map() }
    users.set(userId, data)
  }
  return data
}

/** Mirrors the Dynamo `by-updated` LSI query: `sk2 > since`, ascending. */
function readSince(users: Map<string, UserData>, userId: string, since: number): StateResponse {
  const now = syncWatermark()
  const threshold = padTimestamp(since)
  const data = getUserData(users, userId)

  const items = [...data.rows.entries()]
    .filter(([, row]) => row.sk2 > threshold)
    .sort(([, a], [, b]) => (a.sk2 < b.sk2 ? -1 : a.sk2 > b.sk2 ? 1 : 0))
    .map(([key, row]) => ({
      sk: key,
      collection: row.collection,
      data: structuredClone(row.data),
    }))

  return toStateResponse(items, now)
}

function getRow(
  users: Map<string, UserData>,
  userId: string,
  collection: CollectionName,
  id: string,
): Row | undefined {
  const row = getUserData(users, userId).rows.get(sk(collection, id))
  return row ? structuredClone(row.data) : undefined
}

/** Used by the worker to write model output back. Unconditional: last write wins. */
function putRow(
  users: Map<string, UserData>,
  userId: string,
  collection: CollectionName,
  row: Row,
): void {
  const data = getUserData(users, userId)
  data.rows.set(sk(collection, row.id), {
    collection,
    sk2: updatedSk(row.updatedAt, collection, row.id),
    data: structuredClone(row),
  })
}

/** Resolves a recorded idempotency batch to its rows, skipping any that vanished. */
function resolveRefs(data: UserData, refs: RowRef[]): ResolvedRow[] {
  return refs.flatMap((ref) => {
    const row = data.rows.get(sk(ref.collection, ref.id))
    return row ? [{ collection: ref.collection, row: structuredClone(row.data) }] : []
  })
}

function applyMutations(
  users: Map<string, UserData>,
  userId: string,
  request: MutationRequest,
): ApplyResult {
  const data = getUserData(users, userId)
  const idempotencyKey = idempotencySk(request.idempotencyKey)

  // No `await` between this check and the write below: every step here is a
  // synchronous Map access, so nothing else can run in between. That makes
  // this the single-process equivalent of the conditioned transaction
  // dynamo.ts uses to detect a replay.
  const recorded = data.idempotency.get(idempotencyKey)
  if (recorded) {
    return { rows: resolveRefs(data, recorded), replayed: true }
  }

  const existing = new Map<string, Row>()
  for (const ref of refsToLoad(request)) {
    const row = data.rows.get(sk(ref.collection, ref.id))
    if (row) existing.set(sk(ref.collection, ref.id), row.data)
  }

  const resolved = resolveMutations(request, existing, Date.now())

  for (const { collection, row } of resolved) {
    data.rows.set(sk(collection, row.id), {
      collection,
      sk2: updatedSk(row.updatedAt, collection, row.id),
      data: structuredClone(row),
    })
  }
  data.idempotency.set(
    idempotencyKey,
    resolved.map(({ collection, row }) => ({ collection, id: row.id })),
  )

  return { rows: resolved, replayed: false }
}

export function createMemoryStore(): Store {
  const users = new Map<string, UserData>()

  return {
    readSince: async (userId, since) => readSince(users, userId, since),
    getRow: async (userId, collection, id) => getRow(users, userId, collection, id),
    putRow: async (userId, collection, row) => putRow(users, userId, collection, row),
    applyMutations: async (userId, request) => applyMutations(users, userId, request),
  }
}
