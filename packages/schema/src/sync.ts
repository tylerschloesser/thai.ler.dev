import { z } from 'zod'
import { ClarificationSchema } from './clarification.ts'
import { CollectionNameSchema } from './common.ts'
import { TranslationSchema } from './translation.ts'

/**
 * One write, in the shape TanStack DB hands to a mutation handler. The wire
 * format is deliberately generic: the app has exactly one write endpoint, and
 * the server decides what a write *means* by looking at the resulting state —
 * not by which URL it arrived on.
 */
export const MutationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('insert'),
    collection: CollectionNameSchema,
    key: z.string(),
    modified: z.unknown(),
  }),
  z.object({
    type: z.literal('update'),
    collection: CollectionNameSchema,
    key: z.string(),
    changes: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('delete'),
    collection: CollectionNameSchema,
    key: z.string(),
  }),
])
export type Mutation = z.infer<typeof MutationSchema>

export const MutationRequestSchema = z.object({
  /**
   * Stable for the life of an outbox entry, so a retry after an ambiguous
   * network failure is a no-op rather than a duplicate.
   */
  idempotencyKey: z.string().min(1),
  mutations: z.array(MutationSchema).min(1).max(50),
})
export type MutationRequest = z.infer<typeof MutationRequestSchema>

/**
 * Both the `GET /api/state` response and the `POST /api/mutations` response.
 * One shape means the client merges server output through a single code path.
 *
 * `now` is the server clock at the end of the read, and becomes the next
 * request's `since`. Using the server's clock rather than the client's is what
 * keeps incremental sync correct across devices with skewed clocks.
 */
export const StateResponseSchema = z.object({
  translations: z.array(TranslationSchema),
  clarifications: z.array(ClarificationSchema),
  now: z.number().int(),
})
export type StateResponse = z.infer<typeof StateResponseSchema>

export const ErrorResponseSchema = z.object({
  error: z.string(),
})
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
