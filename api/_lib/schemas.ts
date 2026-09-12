import { z } from 'zod'
import { RUN_PROVIDERS, RUN_STATES } from '../../src/lib/records.js'
import { LineAnnotationSchema } from '../../src/llm/schema.js'

/**
 * Zod validators for the shared record contract (`src/lib/records.ts`),
 * used by handlers that accept a record over the wire (`POST /api/annotate`,
 * `PUT /api/sync/record`, `POST /api/test/seed`). Kept here rather than in
 * `src/lib/records.ts` itself, which is the frozen M1/M2 contract (pure
 * types only, no zod dependency).
 */

export const MODEL_IDS = ['claude-opus-5', 'claude-sonnet-5'] as const
export type ModelId = (typeof MODEL_IDS)[number]

export const DialogueSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  title: z.string(),
  sourceText: z.string(),
  currentAnnotationId: z.string().nullable(),
})

const AnnotationRunSchema = z.object({
  state: z.enum(RUN_STATES),
  provider: z.enum(RUN_PROVIDERS),
  leaseUntil: z.string().nullable(),
  hops: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
})

export const AnnotationRecordSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  dialogueId: z.string().min(1),
  model: z.string(),
  promptVersion: z.number().int(),
  schemaVersion: z.number().int(),
  lines: z.array(LineAnnotationSchema.nullable()),
  lineErrors: z.array(z.string().nullable()),
  status: z.enum(['partial', 'complete']),
  usage: z.object({
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    cacheReadTokens: z.number().nonnegative(),
  }),
  durationMs: z.number().nonnegative(),
  run: AnnotationRunSchema,
})

export const SettingRowSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  updatedAt: z.string(),
})
