/**
 * The seam every caller goes through to reach persisted rows. The request
 * path, the worker, and (eventually) tests each get a different `Store`
 * implementation behind this same interface.
 */

import type { CollectionName, MutationRequest, StateResponse } from '@thai/schema'
import { env } from '../env.ts'
import type { Row } from '../normalize.ts'
import { createDynamoStore } from './dynamo.ts'
import { createMemoryStore } from './memory.ts'

export type RowRef = { collection: CollectionName; id: string }
export type ResolvedRow = { collection: CollectionName; row: Row }
export type ApplyResult = { rows: ResolvedRow[]; replayed: boolean }

export interface Store {
  readSince(userId: string, since: number): Promise<StateResponse>
  getRow(userId: string, collection: CollectionName, id: string): Promise<Row | undefined>
  putRow(userId: string, collection: CollectionName, row: Row): Promise<void>
  applyMutations(userId: string, request: MutationRequest): Promise<ApplyResult>
}

let cached: Store | undefined

/**
 * Lazy so importing this module constructs no client, and so a test can set
 * STORE first. The choice between `dynamo` and `memory` is made once per
 * process, from `env.store` (set via the `STORE` env var).
 */
export function getStore(): Store {
  cached ??= env.store === 'memory' ? createMemoryStore() : createDynamoStore()
  return cached
}
