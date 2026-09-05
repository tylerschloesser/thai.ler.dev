import { z } from 'zod'

/**
 * Lifecycle of a row whose content is produced by the server (an LLM call).
 *
 * This is the load-bearing idea of the data model: the progress of server-side
 * work is a *field on the row*, not React state. That is what lets an in-flight
 * translation survive a reload, a closed tab, or being offline — and what lets
 * the client's write path stay identical for LLM-backed and plain mutations.
 */
export const RowStatusSchema = z.enum(['pending', 'ready', 'failed'])
export type RowStatus = z.infer<typeof RowStatusSchema>

/** Fields every synced row carries, regardless of collection. */
export const SyncFieldsSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number().int(),
  /** Server-assigned. Drives incremental sync; clients send 0 and it is overwritten. */
  updatedAt: z.number().int(),
  /** Tombstone. Deletes are soft so they can propagate to other devices. */
  deleted: z.boolean(),
})

export const COLLECTION_NAMES = ['translations', 'clarifications'] as const
export const CollectionNameSchema = z.enum(COLLECTION_NAMES)
export type CollectionName = z.infer<typeof CollectionNameSchema>
