import { z } from 'zod'

/**
 * Structured-output schema for a single annotated dialogue line, per
 * PLAN.MD §4.2. Verified structured-output constraints: every property is
 * required (no `.optional()` - use `.nullable()` instead), objects have no
 * unknown properties, there's no recursion, and there are no numeric or
 * string-length constraints (the SDK strips those into descriptions rather
 * than enforcing them). Fixed 4-level nesting (line -> sentence -> word ->
 * syllable) is fine.
 */

/** Bump whenever the schema shape below changes; stored on every AnnotationRecord. */
export const SCHEMA_VERSION = 1

export const TONES = ['mid', 'low', 'falling', 'high', 'rising'] as const
export type Tone = (typeof TONES)[number]

export const NOTE_KINDS = [
  'common_phrase',
  'pronunciation',
  'spelling_mismatch',
  'particle',
  'register',
  'classifier',
  'loanword',
  'compound',
  'idiom',
  'colloquial',
  'no_equivalent',
  'grammar',
  'culture',
  'other',
] as const
export type NoteKind = (typeof NOTE_KINDS)[number]

export const POS = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'particle',
  'classifier',
  'preposition',
  'conjunction',
  'question_word',
  'number',
  'name',
  'interjection',
  'other',
] as const
export type PartOfSpeech = (typeof POS)[number]

const Note = z.object({
  kind: z.enum(NOTE_KINDS),
  text: z.string(),
})

const Syllable = z.object({
  thai: z.string(),
  romanization: z.string(),
  tone: z.enum(TONES),
  // "low-class initial ค + live syllable + mai tho -> high"
  toneExplanation: z.string().nullable(),
  // only when the syllable is a meaningful morpheme
  meaning: z.string().nullable(),
})

const Word = z.object({
  thai: z.string(),
  romanization: z.string(),
  gloss: z.string(),
  partOfSpeech: z.enum(POS),
  syllables: z.array(Syllable),
  notes: z.array(Note),
})

const Sentence = z.object({
  thai: z.string(),
  romanization: z.string(),
  translation: z.string(),
  // word-by-word rendering, only when it teaches something useful
  literal: z.string().nullable(),
  words: z.array(Word),
  notes: z.array(Note),
})

export const LineAnnotationSchema = z.object({
  speaker: z.string().nullable(),
  thai: z.string(),
  translation: z.string(),
  sentences: z.array(Sentence),
  notes: z.array(Note),
})

export type NoteAnnotation = z.infer<typeof Note>
export type SyllableAnnotation = z.infer<typeof Syllable>
export type WordAnnotation = z.infer<typeof Word>
export type SentenceAnnotation = z.infer<typeof Sentence>
export type LineAnnotation = z.infer<typeof LineAnnotationSchema>

export interface InvariantCheckResult {
  warnings: string[]
}

function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, '')
}

/**
 * Post-validation invariants that structured output alone can't guarantee:
 * word `thai` concatenated (whitespace removed) should reproduce the
 * sentence `thai`, and syllable `thai` concatenated should reproduce the
 * word `thai`. Never throws - a violation is a warning shown subtly in the
 * UI, not a hard failure, since Thai segmentation quality varies.
 */
export function checkInvariants(line: LineAnnotation): InvariantCheckResult {
  const warnings: string[] = []

  line.sentences.forEach((sentence, sentenceIndex) => {
    const wordsConcatenated = stripWhitespace(
      sentence.words.map((word) => word.thai).join(''),
    )
    const sentenceThai = stripWhitespace(sentence.thai)
    if (wordsConcatenated !== sentenceThai) {
      warnings.push(
        `sentence ${sentenceIndex}: concatenated word text ("${wordsConcatenated}") ` +
          `does not match the sentence text ("${sentenceThai}")`,
      )
    }

    sentence.words.forEach((word, wordIndex) => {
      const syllablesConcatenated = stripWhitespace(
        word.syllables.map((syllable) => syllable.thai).join(''),
      )
      const wordThai = stripWhitespace(word.thai)
      if (syllablesConcatenated !== wordThai) {
        warnings.push(
          `sentence ${sentenceIndex} word ${wordIndex}: concatenated syllable text ` +
            `("${syllablesConcatenated}") does not match the word text ("${wordThai}")`,
        )
      }
    })
  })

  return { warnings }
}
