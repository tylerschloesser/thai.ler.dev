import { z } from 'zod'
import { RowStatusSchema, SyncFieldsSchema } from './common.ts'

export const TONES = ['mid', 'low', 'falling', 'high', 'rising'] as const
export const ToneSchema = z.enum(TONES)
export type Tone = z.infer<typeof ToneSchema>

export const SyllableSchema = z.object({
  thai: z.string(),
  /** Phonetic romanization of this syllable alone. */
  romanization: z.string(),
  tone: ToneSchema,
})
export type Syllable = z.infer<typeof SyllableSchema>

export const SegmentSchema = z.object({
  /** Stable within a line (`s0`, `s1`, ...). Clarifications anchor to these. */
  id: z.string(),
  thai: z.string(),
  romanization: z.string(),
  syllables: z.array(SyllableSchema),
  /** Short English gloss for this segment on its own. */
  gloss: z.string(),
  partOfSpeech: z.string(),
  /** Register, politeness, idiom, or grammar note. Null when there is nothing to add. */
  note: z.string().nullable(),
})
export type Segment = z.infer<typeof SegmentSchema>

export const LineSchema = z.object({
  /** Stable within a translation (`l0`, `l1`, ...). */
  id: z.string(),
  /** Speaker attribution when the source marks one, else null. */
  speaker: z.string().nullable(),
  thai: z.string(),
  /** Natural English for the whole line, not a word-by-word join of the segments. */
  translation: z.string(),
  segments: z.array(SegmentSchema),
})
export type Line = z.infer<typeof LineSchema>

/**
 * Exactly what the model is asked to return. Kept separate from the stored row
 * so the model never sees — or has to invent — sync bookkeeping fields.
 *
 * This same schema is handed to the Messages API as `output_config.format`,
 * so a response the client cannot store is impossible by construction.
 */
export const BreakdownSchema = z.object({
  lines: z.array(LineSchema),
  /** One or two sentences on register, setting, and anything notable. */
  summary: z.string(),
})
export type Breakdown = z.infer<typeof BreakdownSchema>

export const TranslationSchema = SyncFieldsSchema.extend({
  sourceText: z.string(),
  status: RowStatusSchema,
  /** Empty until `status` is `ready`. */
  lines: z.array(LineSchema),
  summary: z.string().nullable(),
  /** Populated only when `status` is `failed`. */
  error: z.string().nullable(),
})
export type Translation = z.infer<typeof TranslationSchema>
