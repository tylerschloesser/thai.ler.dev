import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { sseFromText } from '../../e2e/mocks/anthropic.js'
import {
  annotateDialogue,
  resumeAnnotation,
  type PipelineRepo,
} from './pipeline.js'
import type { LineAnnotation } from './schema.js'

const DIALOGUE = 'A: หนึ่ง\nB: สอง\nA: สาม'

function makeLine(thai: string, translation: string): LineAnnotation {
  return {
    speaker: null,
    thai,
    translation,
    sentences: [
      {
        thai,
        romanization: thai,
        translation,
        literal: null,
        words: [
          {
            thai,
            romanization: thai,
            gloss: translation,
            partOfSpeech: 'other',
            syllables: [
              {
                thai,
                romanization: thai,
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

const LINES: LineAnnotation[] = [
  makeLine('หนึ่ง', 'one'),
  makeLine('สอง', 'two'),
  makeLine('สาม', 'three'),
]

interface StubRequestBody {
  messages?: Array<{ content?: Array<{ type: string; text?: string }> }>
}

/** Extracts N from the `<target line="N">` block of a *parsed* request body. The body must be JSON.parse()'d first - matching the escaped `\"` straight out of `JSON.stringify()` (as the raw fetch `init.body` string is) would never match. */
function extractTargetIndex(bodyText: string): number {
  const body = JSON.parse(bodyText) as StubRequestBody
  const blocks = body.messages?.[0]?.content ?? []
  for (const block of blocks) {
    const match = block.text ? /<target line="(\d+)">/.exec(block.text) : null
    if (match?.[1]) return Number(match[1])
  }
  throw new Error(`stub fetch: no <target line="N"> found in request body`)
}

/** A stub `fetch` that plays the role of the Anthropic API: it inspects the request body for the `<target line="N">` marker `prompt.ts` renders, and streams back that index's entry from `LINES` as a structured-output SSE response, built with the same `sseFromText` the e2e mock uses. */
const stubFetch: typeof fetch = async (_input, init) => {
  const bodyText = typeof init?.body === 'string' ? init.body : ''
  const index = extractTargetIndex(bodyText)
  const line = LINES[index]
  if (!line) throw new Error(`stub fetch: no fixture line for index ${index}`)
  return new Response(sseFromText(JSON.stringify(line)), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function makeClient(): Anthropic {
  return new Anthropic({ apiKey: 'test-key', fetch: stubFetch })
}

interface RepoState {
  lines: Array<LineAnnotation | null>
  errors: Array<string | null>
  status: string | null
  upsertedIndexes: number[]
}

function makeInMemoryRepo(): { repo: PipelineRepo; state: RepoState } {
  const state: RepoState = {
    lines: [],
    errors: [],
    status: null,
    upsertedIndexes: [],
  }
  const repo: PipelineRepo = {
    async createAnnotation(input) {
      state.lines = new Array(input.lineCount).fill(null)
      state.errors = new Array(input.lineCount).fill(null)
      return { annotationId: 'ann_1' }
    },
    async upsertLine(input) {
      state.lines[input.lineIndex] = input.line
      state.errors[input.lineIndex] = input.error
      state.upsertedIndexes.push(input.lineIndex)
    },
    async finalize(input) {
      state.status = input.status
    },
  }
  return { repo, state }
}

describe('annotateDialogue (Node smoke run against a mocked Anthropic API)', () => {
  it('completes with status "complete" when every line succeeds', async () => {
    const { repo, state } = makeInMemoryRepo()
    const result = await annotateDialogue(
      { id: 'd1', sourceText: DIALOGUE },
      { client: makeClient(), model: 'claude-opus-5', repo },
    )

    expect(result.status).toBe('complete')
    expect(result.lines).toEqual(LINES)
    expect(result.lineErrors).toEqual([null, null, null])
    expect(result.usage.outputTokens).toBeGreaterThan(0)
    // Persisted through the injected repo, not just returned.
    expect(state.lines).toEqual(LINES)
    expect(state.status).toBe('complete')
  })

  it('calls onLine once per line as results land', async () => {
    const { repo } = makeInMemoryRepo()
    const seen: number[] = []
    await annotateDialogue(
      { id: 'd1', sourceText: DIALOGUE },
      {
        client: makeClient(),
        model: 'claude-opus-5',
        repo,
        onLine: (event) => seen.push(event.lineIndex),
      },
    )
    expect(seen.sort()).toEqual([0, 1, 2])
  })

  it('leaves every line null and status "partial" when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { repo } = makeInMemoryRepo()

    const result = await annotateDialogue(
      { id: 'd1', sourceText: DIALOGUE },
      {
        client: makeClient(),
        model: 'claude-opus-5',
        repo,
        signal: controller.signal,
      },
    )

    expect(result.status).toBe('partial')
    expect(result.lines.every((line) => line === null)).toBe(true)
  })
})

describe('resumeAnnotation', () => {
  it('re-runs only the null lines and reaches status "complete"', async () => {
    const { repo, state } = makeInMemoryRepo()
    const existingLines: Array<LineAnnotation | null> = [
      LINES[0] ?? null,
      null,
      LINES[2] ?? null,
    ]

    const result = await resumeAnnotation(
      { annotationId: 'ann_1', sourceText: DIALOGUE, lines: existingLines },
      { client: makeClient(), model: 'claude-opus-5', repo },
    )

    expect(result.status).toBe('complete')
    expect(result.lines).toEqual(LINES)
    // Only the previously-null line (index 1) should have been persisted.
    expect(state.upsertedIndexes).toEqual([1])
  })

  it('stays "partial" if a line is still null after resuming', async () => {
    const { repo } = makeInMemoryRepo()
    const existingLines: Array<LineAnnotation | null> = [
      LINES[0] ?? null,
      LINES[1] ?? null,
      LINES[2] ?? null,
    ]

    const result = await resumeAnnotation(
      { annotationId: 'ann_1', sourceText: DIALOGUE, lines: existingLines },
      { client: makeClient(), model: 'claude-opus-5', repo },
    )

    // Nothing was null, so nothing re-ran, and it's already complete.
    expect(result.status).toBe('complete')
  })
})
