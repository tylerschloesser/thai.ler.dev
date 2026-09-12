import { describe, expect, it, vi } from 'vitest'
import { AnnotateError } from '../../../src/llm/annotateLine.js'
import type { SplitLine } from '../../../src/llm/split.js'
import { createFakeProvider } from './fake.js'

const FIXTURE_LINE: SplitLine = {
  speaker: 'พนักงาน',
  text: 'สวัสดีค่ะ รับอะไรดีคะ',
}
const UNKNOWN_LINE: SplitLine = { speaker: 'A', text: 'ไม่มีในฟิกซ์เจอร์' }

describe('createFakeProvider', () => {
  it('matches a fixture line by Thai text', async () => {
    const provider = createFakeProvider({
      provider: 'fake',
      delayMs: 0,
      errorKind: null,
    })
    const result = await provider.annotate({
      model: 'claude-opus-5',
      lines: [FIXTURE_LINE],
      lineIndex: 0,
    })
    expect(result.line.thai).toBe(FIXTURE_LINE.text)
    expect(result.line.translation).toBe('Hello! What would you like to order?')
  })

  it('synthesizes a minimal schema-valid line for text not in the fixture', async () => {
    const provider = createFakeProvider({
      provider: 'fake',
      delayMs: 0,
      errorKind: null,
    })
    const result = await provider.annotate({
      model: 'claude-opus-5',
      lines: [UNKNOWN_LINE],
      lineIndex: 0,
    })
    expect(result.line.thai).toBe(UNKNOWN_LINE.text)
    expect(result.line.speaker).toBe(UNKNOWN_LINE.speaker)
    expect(result.line.translation).toBe(`[fake] ${UNKNOWN_LINE.text}`)
    expect(result.line.sentences).toHaveLength(1)
    expect(result.line.sentences[0]!.words).toHaveLength(1)
    expect(result.line.sentences[0]!.words[0]!.syllables).toHaveLength(1)
  })

  it('defaults to 0ms delay for "fake" and 300ms for "fake-slow"', async () => {
    const sleep = vi.fn(async () => {})
    await createFakeProvider({
      provider: 'fake',
      delayMs: null,
      errorKind: null,
      sleep,
    }).annotate({ model: 'm', lines: [UNKNOWN_LINE], lineIndex: 0 })
    expect(sleep).not.toHaveBeenCalled()

    const sleepSlow = vi.fn(async () => {})
    await createFakeProvider({
      provider: 'fake-slow',
      delayMs: null,
      errorKind: null,
      sleep: sleepSlow,
    }).annotate({ model: 'm', lines: [UNKNOWN_LINE], lineIndex: 0 })
    expect(sleepSlow).toHaveBeenCalledWith(300)
  })

  it('thai_fake_delay_ms overrides the provider default', async () => {
    const sleep = vi.fn(async () => {})
    await createFakeProvider({
      provider: 'fake',
      delayMs: 1000,
      errorKind: null,
      sleep,
    }).annotate({ model: 'm', lines: [UNKNOWN_LINE], lineIndex: 0 })
    expect(sleep).toHaveBeenCalledWith(1000)
  })

  it('fails every line with the injected error kind', async () => {
    const provider = createFakeProvider({
      provider: 'fake',
      delayMs: 0,
      errorKind: 'rate_limited',
    })
    const err = await provider
      .annotate({ model: 'm', lines: [UNKNOWN_LINE], lineIndex: 0 })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AnnotateError)
    expect((err as AnnotateError).kind).toBe('rate_limited')
  })

  it('calls onStart right after a microtask, before the result resolves', async () => {
    const calls: string[] = []
    const provider = createFakeProvider({
      provider: 'fake',
      delayMs: 0,
      errorKind: null,
    })
    const promise = provider.annotate({
      model: 'm',
      lines: [UNKNOWN_LINE],
      lineIndex: 0,
      onStart: () => calls.push('start'),
    })
    await promise
    calls.push('resolved')
    expect(calls).toEqual(['start', 'resolved'])
  })
})
