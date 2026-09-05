/**
 * Fake `Model` used when `MODEL_PROVIDER=fake` (`pnpm dev`, e2e tests) — no
 * network call, no Anthropic secret, deterministic output so a test can
 * assert on it.
 */

import { setTimeout } from 'node:timers/promises'
import type {
  Breakdown,
  Clarification,
  ClarificationAnswer,
  Line,
  Segment,
  Translation,
} from '@thai/schema'
import type { Model } from './index.ts'

const SPEAKER_RE = /^(\S{1,20}):\s+(.*)$/

/**
 * Ids that have already failed once in this process, so a retry succeeds.
 * Per-process: a restart forgets this, so a retry after a Lambda cold start
 * (or a fresh `pnpm dev`) fails again. An e2e test relies on the
 * fail-then-succeed sequence happening within one run.
 */
const failedOnce = new Set<string>()

export function createFakeModel({ delayMs }: { delayMs: number }): Model {
  return {
    breakdown: async (translation) => {
      await setTimeout(delayMs)
      checkFailOnce(translation.id, translation.sourceText)
      return fakeBreakdown(translation)
    },
    clarify: async (clarification, _translation) => {
      await setTimeout(delayMs)
      checkFailOnce(clarification.id, clarification.question)
      return fakeClarify(clarification)
    },
  }
}

function checkFailOnce(id: string, text: string): void {
  if (!text.includes('FAIL')) return
  if (failedOnce.has(id)) return
  failedOnce.add(id)
  throw new Error('fake model failure requested')
}

function fakeBreakdown(translation: Translation): Breakdown {
  const lines: Line[] = translation.sourceText
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((rawLine, lineIndex) => {
      const match = SPEAKER_RE.exec(rawLine)
      const speaker = match ? match[1]! : null
      const thai = match ? match[2]! : rawLine

      const segments: Segment[] = thai
        .split(/\s+/)
        .filter((token) => token.length > 0)
        .map((token, segmentIndex) => ({
          id: `s${segmentIndex}`,
          thai: token,
          romanization: 'fake',
          syllables: [{ thai: token, romanization: 'fake', tone: 'mid' }],
          gloss: `gloss of ${token}`,
          partOfSpeech: 'noun',
          note: null,
        }))

      return {
        id: `l${lineIndex}`,
        speaker,
        thai,
        translation: `[fake] ${thai}`,
        segments,
      }
    })

  return {
    lines,
    summary: `Fake breakdown of ${lines.length} line(s).`,
  }
}

function fakeClarify(clarification: Clarification): ClarificationAnswer {
  const selection =
    clarification.segmentIds.length > 0
      ? clarification.segmentIds.join(', ')
      : 'the whole line'

  return {
    answer: `[fake] You asked "${clarification.question}" about ${selection}`,
  }
}
