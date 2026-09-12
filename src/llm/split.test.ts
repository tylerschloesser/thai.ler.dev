import { describe, expect, it } from 'vitest'
import { splitDialogue } from './split.js'

describe('splitDialogue', () => {
  it('splits on newlines and extracts ASCII-colon speakers', () => {
    const result = splitDialogue('A: hello\nB: hi there')
    expect(result).toEqual([
      { speaker: 'A', text: 'hello' },
      { speaker: 'B', text: 'hi there' },
    ])
  })

  it('extracts a speaker from a fullwidth colon (：)', () => {
    const result = splitDialogue('ลูกค้า：ขอผัดไทย')
    expect(result).toEqual([{ speaker: 'ลูกค้า', text: 'ขอผัดไทย' }])
  })

  it('treats a line with no speaker prefix as speaker: null', () => {
    const result = splitDialogue('ไม่มีชื่อผู้พูดอยู่ในบรรทัดนี้')
    expect(result).toEqual([
      { speaker: null, text: 'ไม่มีชื่อผู้พูดอยู่ในบรรทัดนี้' },
    ])
  })

  it('normalizes CRLF line endings', () => {
    const result = splitDialogue('A: hello\r\nB: hi\r\n')
    expect(result).toEqual([
      { speaker: 'A', text: 'hello' },
      { speaker: 'B', text: 'hi' },
    ])
  })

  it('drops blank lines', () => {
    const result = splitDialogue('A: hello\n\n\nB: hi\n')
    expect(result).toEqual([
      { speaker: 'A', text: 'hello' },
      { speaker: 'B', text: 'hi' },
    ])
  })

  it('falls back to a single line for a paragraph with no newlines', () => {
    const result = splitDialogue('just one long sentence with no speaker')
    expect(result).toEqual([
      { speaker: null, text: 'just one long sentence with no speaker' },
    ])
  })

  it('returns an empty array for empty or all-blank input', () => {
    expect(splitDialogue('')).toEqual([])
    expect(splitDialogue('   \n\n  ')).toEqual([])
  })

  it('does not treat a colon deep in a long prefix as a speaker label beyond 24 chars', () => {
    // The speaker group is capped at 24 chars, but the regex is unanchored on
    // length beyond requiring *some* match within the first 24 chars before a
    // colon - a colon further in with a long candidate label included should
    // still match because {1,24} matches greedily up to the colon;
    // to actually exercise the length cap we need >24 chars before the colon.
    const longPrefix = 'x'.repeat(30)
    const result = splitDialogue(`${longPrefix}: text`)
    expect(result).toEqual([{ speaker: null, text: `${longPrefix}: text` }])
  })
})
