import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LineAnnotationSchema, type LineAnnotation } from './schema.js'
import { sseFromText } from '../../e2e/mocks/anthropic.js'

const SAMPLE_LINE: LineAnnotation = {
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
          thai: 'สวัสดี',
          romanization: 'sà-wàt-dii',
          gloss: 'hello',
          partOfSpeech: 'interjection',
          syllables: [
            {
              thai: 'สวัส',
              romanization: 'sà-wàt',
              tone: 'low',
              toneExplanation:
                'mid-class initial ส + dead syllable + no tone mark -> low',
              meaning: null,
            },
            {
              thai: 'ดี',
              romanization: 'dii',
              tone: 'mid',
              toneExplanation:
                'mid-class initial ด + live syllable + no tone mark -> mid',
              meaning: 'good',
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
          notes: [],
        },
      ],
      notes: [],
    },
  ],
  notes: [],
}

describe('sseFromText + the real Anthropic SDK (stubbed fetch)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('round-trips a structured-output response through client.messages.stream()', async () => {
    const sseBody = sseFromText(JSON.stringify(SAMPLE_LINE))

    const stubFetch = vi.fn(
      async () =>
        new Response(sseBody, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    )

    const client = new Anthropic({
      apiKey: 'test-key',
      fetch: stubFetch as unknown as typeof fetch,
    })

    const stream = client.messages.stream({
      model: 'claude-opus-5',
      max_tokens: 16000,
      messages: [{ role: 'user', content: 'irrelevant - fetch is stubbed' }],
      output_config: { format: zodOutputFormat(LineAnnotationSchema) },
    })

    const message = await stream.finalMessage()

    expect(stubFetch).toHaveBeenCalledTimes(1)
    expect(message.stop_reason).toBe('end_turn')
    expect(message.parsed_output).not.toBeNull()

    const validation = LineAnnotationSchema.safeParse(message.parsed_output)
    expect(validation.success).toBe(true)
    expect(message.parsed_output).toEqual(SAMPLE_LINE)
  })
})
