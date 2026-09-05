import { z } from 'zod'
import { RowStatusSchema, SyncFieldsSchema } from './common.ts'

/** What the model returns for a clarification. */
export const ClarificationAnswerSchema = z.object({
  answer: z.string(),
})
export type ClarificationAnswer = z.infer<typeof ClarificationAnswerSchema>

export const ClarificationSchema = SyncFieldsSchema.extend({
  translationId: z.string(),
  /** The line the selection sits in. */
  lineId: z.string(),
  /** The user's selection, anchored to stable segment ids. Empty means the whole line. */
  segmentIds: z.array(z.string()),
  question: z.string(),
  status: RowStatusSchema,
  answer: z.string().nullable(),
  error: z.string().nullable(),
})
export type Clarification = z.infer<typeof ClarificationSchema>
