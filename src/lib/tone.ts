import type { Tone } from '../llm/schema'

/**
 * The same Thai tone-rule table the LLM system prompt is built from (see
 * `src/llm/prompt.ts`), kept here as plain data for a future UI "why this
 * tone" explainer (PLAN.MD §4.2/§4.3). Only a type-only import from
 * `src/llm/schema` is used, so this module carries no runtime dependency on
 * the LLM layer.
 */

export type ConsonantClass = 'low' | 'mid' | 'high'
export type SyllableWeight = 'live' | 'dead'
export type VowelLength = 'short' | 'long'
export type ToneMark =
  'none' | 'mai_ek' | 'mai_tho' | 'mai_tri' | 'mai_chattawa'

export interface ToneRule {
  consonantClass: ConsonantClass
  syllableWeight: SyllableWeight
  /** Only distinguishes low-class dead syllables; null elsewhere. */
  vowelLength: VowelLength | null
  toneMark: ToneMark
  tone: Tone
}

// Standard Thai tone rules (consonant class x syllable weight x vowel
// length x tone mark -> tone). See http://www.thai-language.com/ref/tone-rules.
export const TONE_RULES: ToneRule[] = [
  // Mid class
  {
    consonantClass: 'mid',
    syllableWeight: 'live',
    vowelLength: null,
    toneMark: 'none',
    tone: 'mid',
  },
  {
    consonantClass: 'mid',
    syllableWeight: 'dead',
    vowelLength: null,
    toneMark: 'none',
    tone: 'low',
  },
  {
    consonantClass: 'mid',
    syllableWeight: 'live',
    vowelLength: null,
    toneMark: 'mai_ek',
    tone: 'low',
  },
  {
    consonantClass: 'mid',
    syllableWeight: 'dead',
    vowelLength: null,
    toneMark: 'mai_ek',
    tone: 'low',
  },
  {
    consonantClass: 'mid',
    syllableWeight: 'live',
    vowelLength: null,
    toneMark: 'mai_tho',
    tone: 'falling',
  },
  {
    consonantClass: 'mid',
    syllableWeight: 'dead',
    vowelLength: null,
    toneMark: 'mai_tho',
    tone: 'falling',
  },
  {
    consonantClass: 'mid',
    syllableWeight: 'live',
    vowelLength: null,
    toneMark: 'mai_tri',
    tone: 'high',
  },
  {
    consonantClass: 'mid',
    syllableWeight: 'dead',
    vowelLength: null,
    toneMark: 'mai_tri',
    tone: 'high',
  },
  {
    consonantClass: 'mid',
    syllableWeight: 'live',
    vowelLength: null,
    toneMark: 'mai_chattawa',
    tone: 'rising',
  },
  {
    consonantClass: 'mid',
    syllableWeight: 'dead',
    vowelLength: null,
    toneMark: 'mai_chattawa',
    tone: 'rising',
  },
  // High class
  {
    consonantClass: 'high',
    syllableWeight: 'live',
    vowelLength: null,
    toneMark: 'none',
    tone: 'rising',
  },
  {
    consonantClass: 'high',
    syllableWeight: 'dead',
    vowelLength: null,
    toneMark: 'none',
    tone: 'low',
  },
  {
    consonantClass: 'high',
    syllableWeight: 'live',
    vowelLength: null,
    toneMark: 'mai_ek',
    tone: 'low',
  },
  {
    consonantClass: 'high',
    syllableWeight: 'dead',
    vowelLength: null,
    toneMark: 'mai_ek',
    tone: 'low',
  },
  {
    consonantClass: 'high',
    syllableWeight: 'live',
    vowelLength: null,
    toneMark: 'mai_tho',
    tone: 'falling',
  },
  {
    consonantClass: 'high',
    syllableWeight: 'dead',
    vowelLength: null,
    toneMark: 'mai_tho',
    tone: 'falling',
  },
  // Low class
  {
    consonantClass: 'low',
    syllableWeight: 'live',
    vowelLength: null,
    toneMark: 'none',
    tone: 'mid',
  },
  {
    consonantClass: 'low',
    syllableWeight: 'dead',
    vowelLength: 'short',
    toneMark: 'none',
    tone: 'high',
  },
  {
    consonantClass: 'low',
    syllableWeight: 'dead',
    vowelLength: 'long',
    toneMark: 'none',
    tone: 'falling',
  },
  {
    consonantClass: 'low',
    syllableWeight: 'live',
    vowelLength: null,
    toneMark: 'mai_ek',
    tone: 'falling',
  },
  {
    consonantClass: 'low',
    syllableWeight: 'dead',
    vowelLength: null,
    toneMark: 'mai_ek',
    tone: 'falling',
  },
  {
    consonantClass: 'low',
    syllableWeight: 'live',
    vowelLength: null,
    toneMark: 'mai_tho',
    tone: 'high',
  },
  {
    consonantClass: 'low',
    syllableWeight: 'dead',
    vowelLength: null,
    toneMark: 'mai_tho',
    tone: 'high',
  },
]

/**
 * Looks up the resulting tone for a given combination. `vowelLength` only
 * matters for low-class dead syllables with no tone mark; pass it whenever
 * it's known, it's ignored otherwise. Returns null for combinations that
 * don't occur in standard Thai (e.g. mai_chattawa on low/high class, which
 * Thai orthography doesn't produce).
 */
export function lookupTone(
  consonantClass: ConsonantClass,
  syllableWeight: SyllableWeight,
  toneMark: ToneMark,
  vowelLength?: VowelLength,
): Tone | null {
  const rule = TONE_RULES.find(
    (r) =>
      r.consonantClass === consonantClass &&
      r.syllableWeight === syllableWeight &&
      r.toneMark === toneMark &&
      (r.vowelLength === null || r.vowelLength === vowelLength),
  )
  return rule?.tone ?? null
}
