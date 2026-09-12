import { describe, expect, it } from 'vitest'
import { buildUserMessage, PROMPT_VERSION, SYSTEM_PROMPT } from './prompt'
import type { SplitLine } from './split'

const LINES: SplitLine[] = [
  { speaker: 'A', text: 'สวัสดีครับ' },
  { speaker: 'B', text: 'สวัสดีค่ะ' },
  { speaker: null, text: 'ยินดีที่ได้รู้จัก' },
]

describe('PROMPT_VERSION', () => {
  it('is a stable positive integer', () => {
    expect(Number.isInteger(PROMPT_VERSION)).toBe(true)
    expect(PROMPT_VERSION).toBeGreaterThan(0)
  })
})

describe('SYSTEM_PROMPT', () => {
  it('is deterministic across evaluations', () => {
    expect(SYSTEM_PROMPT).toBe(SYSTEM_PROMPT)
  })

  it('is non-empty and covers the required sections', () => {
    expect(SYSTEM_PROMPT).toContain('Thai')
    expect(SYSTEM_PROMPT).toMatch(/Paiboon|romaniz/i)
    expect(SYSTEM_PROMPT).toMatch(/tone/i)
    expect(SYSTEM_PROMPT).toMatch(/note/i)
    expect(SYSTEM_PROMPT).toMatch(/translation/i)
  })
})

describe('buildUserMessage', () => {
  it('is deterministic for the same inputs', () => {
    const a = buildUserMessage(LINES, 1)
    const b = buildUserMessage(LINES, 1)
    expect(a).toEqual(b)
  })

  it('produces a byte-identical dialogue block regardless of lineIndex', () => {
    const first = buildUserMessage(LINES, 0)
    const second = buildUserMessage(LINES, 1)
    const third = buildUserMessage(LINES, 2)
    expect(first.dialogueBlock.text).toBe(second.dialogueBlock.text)
    expect(second.dialogueBlock.text).toBe(third.dialogueBlock.text)
  })

  it('marks the dialogue block, and only the dialogue block, cacheable', () => {
    const { dialogueBlock, targetBlock } = buildUserMessage(LINES, 0)
    expect(dialogueBlock.cache_control).toEqual({ type: 'ephemeral' })
    expect(targetBlock.cache_control).toBeUndefined()
  })

  it('includes every line, indexed, in the dialogue block', () => {
    const { dialogueBlock } = buildUserMessage(LINES, 0)
    expect(dialogueBlock.text).toContain('[0] A: สวัสดีครับ')
    expect(dialogueBlock.text).toContain('[1] B: สวัสดีค่ะ')
    expect(dialogueBlock.text).toContain('[2] ยินดีที่ได้รู้จัก')
  })

  it('identifies the target line by index in the target block', () => {
    const { targetBlock } = buildUserMessage(LINES, 1)
    expect(targetBlock.text).toContain('<target line="1">')
    expect(targetBlock.text).toContain('B: สวัสดีค่ะ')
    expect(targetBlock.text).not.toContain('A: สวัสดีครับ')
  })

  it('throws for an out-of-range lineIndex', () => {
    expect(() => buildUserMessage(LINES, 99)).toThrow(RangeError)
  })
})
