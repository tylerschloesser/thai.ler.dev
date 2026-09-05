import {
  ClarificationSchema,
  TranslationSchema,
  type Clarification,
  type CollectionName,
  type Translation,
} from '@thai/schema'
import { z } from 'zod'

export type Row = Translation | Clarification

/** Rejects a mutation permanently — the outbox must not retry it. */
export class InvalidMutationError extends Error {}

/**
 * What a client is allowed to supply when creating a row. Everything else on
 * the stored row is server-owned, so the client cannot fabricate a `ready`
 * translation or write content the model never produced.
 */
const TranslationInsertSchema = z.object({
  id: z.string().min(1),
  sourceText: z.string().min(1).max(8000),
  createdAt: z.number().int().optional(),
})

const ClarificationInsertSchema = z.object({
  id: z.string().min(1),
  translationId: z.string().min(1),
  lineId: z.string().min(1),
  segmentIds: z.array(z.string()).max(128),
  question: z.string().min(1).max(2000),
  createdAt: z.number().int().optional(),
})

/**
 * The only fields a client may change after creation. Setting `status` back to
 * `pending` is how a retry works: there is no separate retry endpoint, the row
 * simply re-enters the state that triggers server-side work.
 */
const TranslationUpdateSchema = z.object({
  deleted: z.boolean().optional(),
  status: z.literal('pending').optional(),
})

const ClarificationUpdateSchema = z.object({
  deleted: z.boolean().optional(),
  status: z.literal('pending').optional(),
  question: z.string().min(1).max(2000).optional(),
})

export function normalizeInsert(
  collection: CollectionName,
  key: string,
  modified: unknown,
  stamp: number,
): Row {
  if (collection === 'translations') {
    const input = parse(TranslationInsertSchema, modified)
    requireKeyMatch(key, input.id)
    return {
      id: input.id,
      sourceText: input.sourceText,
      status: 'pending',
      lines: [],
      summary: null,
      error: null,
      createdAt: input.createdAt ?? stamp,
      updatedAt: stamp,
      deleted: false,
    }
  }

  const input = parse(ClarificationInsertSchema, modified)
  requireKeyMatch(key, input.id)
  return {
    id: input.id,
    translationId: input.translationId,
    lineId: input.lineId,
    segmentIds: input.segmentIds,
    question: input.question,
    status: 'pending',
    answer: null,
    error: null,
    createdAt: input.createdAt ?? stamp,
    updatedAt: stamp,
    deleted: false,
  }
}

export function normalizeUpdate(
  collection: CollectionName,
  existing: Row,
  changes: Record<string, unknown>,
  stamp: number,
): Row {
  if (collection === 'translations') {
    const patch = parse(TranslationUpdateSchema, changes)
    const next: Translation = { ...(existing as Translation), ...patch, updatedAt: stamp }
    // Re-entering `pending` clears the previous attempt so the UI never shows
    // a stale breakdown next to a spinner.
    if (patch.status === 'pending') {
      next.lines = []
      next.summary = null
      next.error = null
    }
    return next
  }

  const patch = parse(ClarificationUpdateSchema, changes)
  const next: Clarification = { ...(existing as Clarification), ...patch, updatedAt: stamp }
  if (patch.status === 'pending') {
    next.answer = null
    next.error = null
  }
  return next
}

export function normalizeDelete(existing: Row, stamp: number): Row {
  return { ...existing, deleted: true, updatedAt: stamp }
}

export function rowSchema(collection: CollectionName) {
  return collection === 'translations' ? TranslationSchema : ClarificationSchema
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new InvalidMutationError(z.prettifyError(result.error))
  }
  return result.data
}

function requireKeyMatch(key: string, id: string): void {
  if (key !== id) {
    throw new InvalidMutationError(`mutation key ${key} does not match row id ${id}`)
  }
}
