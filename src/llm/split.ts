/**
 * Deterministic, pure splitting of a pasted dialogue into speaker-tagged
 * lines. No LLM involvement here - see docs/plans/P0.md §4.2.
 */

export interface SplitLine {
  /** Speaker label extracted from a leading "Name:" or "Name：" prefix, or null if none was found. */
  speaker: string | null
  /** The line text with the speaker prefix (if any) removed, trimmed. */
  text: string
}

// Matches a leading speaker label up to 24 characters, followed by an ASCII
// or fullwidth colon and optional whitespace. Speaker labels don't contain
// colons themselves.
const SPEAKER_RE = /^([^:：]{1,24})[:：]\s*/

function parseLine(raw: string): SplitLine {
  const match = SPEAKER_RE.exec(raw)
  if (match) {
    const [prefix, speaker] = match
    return {
      speaker: speaker.trim(),
      text: raw.slice(prefix.length).trim(),
    }
  }
  return { speaker: null, text: raw }
}

/**
 * Splits `sourceText` into lines: normalizes CRLF, drops blank lines, and
 * extracts a speaker label from each remaining line. A single paragraph
 * with no newlines naturally falls out of this as one line - the model is
 * responsible for splitting it into sentences.
 */
export function splitDialogue(sourceText: string): SplitLine[] {
  return sourceText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseLine)
}
