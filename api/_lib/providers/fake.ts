import fixtureLines from '../../../src/fixtures/sample.annotation.json' with { type: 'json' }
import {
  AnnotateError,
  type AnnotateErrorKind,
} from '../../../src/llm/annotateLine.js'
import type { LineProvider } from '../../../src/llm/provider.js'
import type { LineAnnotation } from '../../../src/llm/schema.js'
import type { SplitLine } from '../../../src/llm/split.js'

/**
 * Fixture-backed `LineProvider` for tests and local dev (PLAN.MD §4.2,
 * §4.8): matches a split line to `src/fixtures/sample.annotation.json` by
 * Thai text, and synthesizes a minimal schema-valid `LineAnnotation` for any
 * text the fixture doesn't cover (so e2e specs can use arbitrary dialogues,
 * not just the fixture's eight lines).
 */

const FIXTURE_LINES = fixtureLines as unknown as LineAnnotation[]

const DEFAULT_DELAY_MS: Record<'fake' | 'fake-slow', number> = {
  fake: 0,
  'fake-slow': 300,
}

function findFixtureLine(thai: string): LineAnnotation | undefined {
  return FIXTURE_LINES.find((line) => line.thai === thai)
}

function synthesizeLine(splitLine: SplitLine): LineAnnotation {
  const thai = splitLine.text
  return {
    speaker: splitLine.speaker,
    thai,
    translation: `[fake] ${thai}`,
    sentences: [
      {
        thai,
        romanization: '',
        translation: `[fake] ${thai}`,
        literal: null,
        words: [
          {
            thai,
            romanization: '',
            gloss: '[fake]',
            partOfSpeech: 'other',
            syllables: [
              {
                thai,
                romanization: '',
                tone: 'mid',
                toneExplanation: null,
                meaning: null,
              },
            ],
            notes: [],
          },
        ],
        notes: [],
      },
    ],
    notes: [],
  }
}

export interface FakeProviderOptions {
  provider: 'fake' | 'fake-slow'
  /** Overrides the provider-default delay (0ms / 300ms) - `thai_fake_delay_ms`. */
  delayMs: number | null
  /** An `AnnotateErrorKind` string; every line fails with this kind while set. */
  errorKind: string | null
  /** Injectable for tests; defaults to a real `setTimeout`-based sleep. */
  sleep?: (ms: number) => Promise<void>
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createFakeProvider(opts: FakeProviderOptions): LineProvider {
  const delay = opts.delayMs ?? DEFAULT_DELAY_MS[opts.provider]
  const sleep = opts.sleep ?? defaultSleep

  return {
    name: opts.provider,
    async annotate({ lines, lineIndex, onStart }) {
      // Fires right after a microtask, mirroring the real provider's
      // `stream.once('streamEvent', ...)` timing closely enough for the
      // runner's warm-up gate to behave the same way under test.
      if (onStart) queueMicrotask(onStart)

      if (delay > 0) await sleep(delay)

      if (opts.errorKind) {
        throw new AnnotateError(
          opts.errorKind as AnnotateErrorKind,
          `fake provider: injected "${opts.errorKind}" error`,
        )
      }

      const splitLine = lines[lineIndex]
      if (!splitLine) {
        throw new AnnotateError(
          'unknown',
          `fake provider: no split line at index ${lineIndex}`,
        )
      }

      const line = findFixtureLine(splitLine.text) ?? synthesizeLine(splitLine)
      return {
        line,
        warnings: [],
        usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0 },
      }
    },
  }
}
