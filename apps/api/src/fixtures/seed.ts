import type { Clarification, Translation } from '@thai/schema'

/**
 * Demo data a fresh local backend starts with (see ../seed.ts). Timestamps
 * are fixed rather than `Date.now()` so a restart of `pnpm --filter api
 * start` produces byte-identical rows.
 */

const SEEDED_AT = 1_700_000_000_000

export const seedTranslationReady: Translation = {
  id: 'seed-translation-ready',
  sourceText: 'A: สวัสดีครับ ชื่ออะไร\nB: ผมชื่อธันย์',
  status: 'ready',
  lines: [
    {
      id: 'l0',
      speaker: 'A',
      thai: 'สวัสดีครับ ชื่ออะไร',
      translation: 'Hello, what is your name?',
      segments: [
        {
          id: 's0',
          thai: 'สวัสดี',
          romanization: 'sa-wat-dii',
          syllables: [
            { thai: 'สวัส', romanization: 'sa-wat', tone: 'low' },
            { thai: 'ดี', romanization: 'dii', tone: 'mid' },
          ],
          gloss: 'hello',
          partOfSpeech: 'interjection',
          note: null,
        },
        {
          id: 's1',
          thai: 'ครับ',
          romanization: 'khrap',
          syllables: [{ thai: 'ครับ', romanization: 'khrap', tone: 'high' }],
          gloss: 'polite particle',
          partOfSpeech: 'particle',
          note: 'used by male speakers to soften a statement or question',
        },
        {
          id: 's2',
          thai: 'ชื่ออะไร',
          romanization: 'chuue a-rai',
          syllables: [
            { thai: 'ชื่อ', romanization: 'chuue', tone: 'falling' },
            { thai: 'อะไร', romanization: 'a-rai', tone: 'mid' },
          ],
          gloss: 'what is (your) name',
          partOfSpeech: 'phrase',
          note: null,
        },
      ],
    },
    {
      id: 'l1',
      speaker: 'B',
      thai: 'ผมชื่อธันย์',
      translation: 'My name is Than.',
      segments: [
        {
          id: 's0',
          thai: 'ผม',
          romanization: 'phom',
          syllables: [{ thai: 'ผม', romanization: 'phom', tone: 'rising' }],
          gloss: 'I / me (male speaker)',
          partOfSpeech: 'pronoun',
          note: null,
        },
        {
          id: 's1',
          thai: 'ชื่อ',
          romanization: 'chuue',
          syllables: [{ thai: 'ชื่อ', romanization: 'chuue', tone: 'falling' }],
          gloss: 'name; to be named',
          partOfSpeech: 'verb',
          note: null,
        },
        {
          id: 's2',
          thai: 'ธันย์',
          romanization: 'than',
          syllables: [{ thai: 'ธันย์', romanization: 'than', tone: 'mid' }],
          gloss: 'Than (a given name)',
          partOfSpeech: 'proper noun',
          note: null,
        },
      ],
    },
  ],
  summary: 'A casual introduction between two speakers, using the polite male particle ครับ.',
  error: null,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deleted: false,
}

export const seedTranslationFailed: Translation = {
  id: 'seed-translation-failed',
  sourceText: 'ขอโทษครับ ผมไม่เข้าใจ',
  status: 'failed',
  lines: [],
  summary: null,
  error: 'The model timed out before returning a breakdown.',
  createdAt: SEEDED_AT + 100_000,
  updatedAt: SEEDED_AT + 100_000,
  deleted: false,
}

export const seedClarification: Clarification = {
  id: 'seed-clarification',
  translationId: 'seed-translation-ready',
  lineId: 'l0',
  segmentIds: ['s0'],
  question: 'Is สวัสดี only used as a greeting, or also to say goodbye?',
  status: 'ready',
  answer:
    'สวัสดี (sa-wat-dii) works for both hello and goodbye in Thai — context tells you which.',
  error: null,
  createdAt: SEEDED_AT + 200_000,
  updatedAt: SEEDED_AT + 200_000,
  deleted: false,
}
