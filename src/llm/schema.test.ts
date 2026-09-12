import { describe, expect, it } from 'vitest'
import {
  checkInvariants,
  LineAnnotationSchema,
  type LineAnnotation,
} from './schema.js'

function makeValidLine(): LineAnnotation {
  return {
    speaker: 'ลูกค้า',
    thai: 'ขอน้ำเปล่าครับ',
    translation: 'I would like some water, please.',
    sentences: [
      {
        thai: 'ขอน้ำเปล่าครับ',
        romanization: 'kǎaw náam bplàaw kráp',
        translation: 'I would like some water, please.',
        literal: null,
        words: [
          {
            thai: 'ขอ',
            romanization: 'kǎaw',
            gloss: 'to ask for / may I have',
            partOfSpeech: 'verb',
            syllables: [
              {
                thai: 'ขอ',
                romanization: 'kǎaw',
                tone: 'rising',
                toneExplanation:
                  'high-class initial ข + live syllable + no tone mark -> rising',
                meaning: null,
              },
            ],
            notes: [],
          },
          {
            thai: 'น้ำเปล่า',
            romanization: 'náam bplàaw',
            gloss: 'plain water',
            partOfSpeech: 'noun',
            syllables: [
              {
                thai: 'น้ำ',
                romanization: 'náam',
                tone: 'high',
                toneExplanation:
                  'low-class initial น + live syllable + mai tho -> high',
                meaning: 'water',
              },
              {
                thai: 'เปล่า',
                romanization: 'bplàaw',
                tone: 'falling',
                toneExplanation:
                  'mid-class initial bp + live syllable + mai ek -> low (shown as falling per model convention)',
                meaning: 'plain / empty',
              },
            ],
            notes: [],
          },
          {
            thai: 'ครับ',
            romanization: 'kráp',
            gloss: 'polite particle (male speaker)',
            partOfSpeech: 'particle',
            syllables: [
              {
                thai: 'ครับ',
                romanization: 'kráp',
                tone: 'high',
                toneExplanation:
                  'low-class initial ค + dead syllable + mai tho -> high',
                meaning: null,
              },
            ],
            notes: [
              {
                kind: 'particle',
                text: 'Polite sentence-final particle used by male speakers; drop it when speaking casually with peers.',
              },
            ],
          },
        ],
        notes: [],
      },
    ],
    notes: [],
  }
}

describe('LineAnnotationSchema', () => {
  it('accepts a well-formed line', () => {
    const result = LineAnnotationSchema.safeParse(makeValidLine())
    expect(result.success).toBe(true)
  })

  it('rejects a line missing a required field', () => {
    const broken = makeValidLine() as unknown as Record<string, unknown>
    delete broken.translation
    const result = LineAnnotationSchema.safeParse(broken)
    expect(result.success).toBe(false)
  })
})

describe('checkInvariants', () => {
  it('produces no warnings for a well-formed line', () => {
    const { warnings } = checkInvariants(makeValidLine())
    expect(warnings).toEqual([])
  })

  it('never throws, and flags a sentence whose words do not reconstruct it', () => {
    const broken = makeValidLine()
    // Corrupt only the sentence's own `thai` field, leaving every word (and
    // its syllables) internally consistent - so only the sentence-level
    // invariant should fire, not the word-level one too.
    broken.sentences[0]!.thai = 'ผิดทั้งหมด'
    const { warnings } = checkInvariants(broken)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/sentence 0:/)
    expect(warnings[0]).toMatch(/does not match the sentence text/)
  })

  it('flags a word whose syllables do not reconstruct it', () => {
    const broken = makeValidLine()
    // Corrupt a syllable so the word-level concatenation invariant breaks,
    // while leaving the word's own `thai` untouched (so only this
    // invariant - not the sentence one - should fire).
    broken.sentences[0]!.words[1]!.syllables[0]!.thai = 'ผิด'
    const { warnings } = checkInvariants(broken)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/sentence 0 word 1:/)
    expect(warnings[0]).toMatch(/does not match the word text/)
  })

  it('reports multiple warnings when multiple invariants are violated', () => {
    const broken = makeValidLine()
    broken.sentences[0]!.thai = 'ผิดทั้งหมด'
    broken.sentences[0]!.words[1]!.syllables[0]!.thai = 'ผิด'
    const { warnings } = checkInvariants(broken)
    expect(warnings).toHaveLength(2)
  })
})
