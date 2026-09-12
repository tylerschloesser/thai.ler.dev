import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { sseFromText } from '../../e2e/mocks/anthropic.js'
import { AnnotateError, annotateLine } from './annotateLine.js'
import type { LineAnnotation } from './schema.js'
import type { SplitLine } from './split.js'

const LINES: SplitLine[] = [{ speaker: 'A', text: 'สวัสดีครับ' }]

const VALID_LINE: LineAnnotation = {
  speaker: 'A',
  thai: 'สวัสดีครับ',
  translation: 'Hello.',
  sentences: [
    {
      thai: 'สวัสดีครับ',
      romanization: 'sà-wàt-dii kráp',
      translation: 'Hello.',
      literal: null,
      words: [
        {
          thai: 'สวัสดีครับ',
          romanization: 'sà-wàt-dii kráp',
          gloss: 'hello',
          partOfSpeech: 'interjection',
          syllables: [
            {
              thai: 'สวัสดีครับ',
              romanization: 'sà-wàt-dii kráp',
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

function clientWithFetch(fetchImpl: typeof fetch): Anthropic {
  return new Anthropic({ apiKey: 'test-key', fetch: fetchImpl, maxRetries: 0 })
}

function sseEvent(type: string, data: object): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
}

/** A minimal SSE stream whose message_delta carries a custom stop_reason/stop_details, for exercising refusal and max_tokens handling. */
function sseWithStopReason(
  stopReason: string,
  stopDetails: object | null = null,
): string {
  return [
    sseEvent('message_start', {
      message: {
        id: 'msg_mock',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    }),
    sseEvent('content_block_start', {
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
    sseEvent('content_block_delta', {
      index: 0,
      delta: { type: 'text_delta', text: '' },
    }),
    sseEvent('content_block_stop', { index: 0 }),
    sseEvent('message_delta', {
      delta: {
        stop_reason: stopReason,
        stop_sequence: null,
        stop_details: stopDetails,
      },
      usage: { output_tokens: 1 },
    }),
    sseEvent('message_stop', {}),
  ].join('')
}

describe('annotateLine', () => {
  it('returns the parsed line, empty warnings, and usage on success', async () => {
    const client = clientWithFetch(
      async () =>
        new Response(sseFromText(JSON.stringify(VALID_LINE)), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )

    const result = await annotateLine(client, {
      model: 'claude-opus-5',
      lines: LINES,
      lineIndex: 0,
    })

    expect(result.line).toEqual(VALID_LINE)
    expect(result.warnings).toEqual([])
    expect(result.usage.outputTokens).toBeGreaterThan(0)
  })

  it('surfaces warnings from checkInvariants without throwing', async () => {
    const broken: LineAnnotation = {
      ...VALID_LINE,
      sentences: [
        {
          ...VALID_LINE.sentences[0]!,
          words: [{ ...VALID_LINE.sentences[0]!.words[0]!, thai: 'ผิด' }],
        },
      ],
    }
    const client = clientWithFetch(
      async () =>
        new Response(sseFromText(JSON.stringify(broken)), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )

    const result = await annotateLine(client, {
      model: 'claude-opus-5',
      lines: LINES,
      lineIndex: 0,
    })

    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('throws a "refusal"-kind AnnotateError when stop_reason is refusal', async () => {
    const client = clientWithFetch(
      async () =>
        new Response(
          sseWithStopReason('refusal', {
            type: 'refusal',
            category: null,
            explanation: 'nope',
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    )

    const err = await annotateLine(client, {
      model: 'claude-opus-5',
      lines: LINES,
      lineIndex: 0,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(AnnotateError)
    expect((err as AnnotateError).kind).toBe('refusal')
  })

  it('throws a "max_tokens"-kind AnnotateError when stop_reason is max_tokens', async () => {
    const client = clientWithFetch(
      async () =>
        new Response(sseWithStopReason('max_tokens'), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )

    const err = await annotateLine(client, {
      model: 'claude-opus-5',
      lines: LINES,
      lineIndex: 0,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(AnnotateError)
    expect((err as AnnotateError).kind).toBe('max_tokens')
  })

  it('maps a 401 API response to an "authentication"-kind AnnotateError', async () => {
    const client = clientWithFetch(
      async () =>
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'authentication_error', message: 'bad key' },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
    )

    const err = await annotateLine(client, {
      model: 'claude-opus-5',
      lines: LINES,
      lineIndex: 0,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(AnnotateError)
    expect((err as AnnotateError).kind).toBe('authentication')
  })

  it('maps a 429 API response to a "rate_limited"-kind AnnotateError', async () => {
    const client = clientWithFetch(
      async () =>
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'rate_limit_error', message: 'slow down' },
          }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        ),
    )

    const err = await annotateLine(client, {
      model: 'claude-opus-5',
      lines: LINES,
      lineIndex: 0,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(AnnotateError)
    expect((err as AnnotateError).kind).toBe('rate_limited')
  })
})
