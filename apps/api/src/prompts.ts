import type { Clarification, Line, Translation } from '@thai/schema'

export const BREAKDOWN_SYSTEM = `You break Thai dialog down for an English-speaking learner.

Given Thai text, split it into lines and each line into segments, then explain it.

Lines
- One line per utterance. If the source marks speakers (\`A:\`, \`สมชาย:\`, dashes), put the
  speaker's label in \`speaker\` and keep it out of \`thai\`. Otherwise \`speaker\` is null.
- Give each line an id: \`l0\`, \`l1\`, \`l2\`, in order.
- \`translation\` is natural, idiomatic English for the whole line — how a person would
  actually say it, not a word-by-word join of the segments.

Segments
- Segment on word boundaries as a Thai reader perceives them, since Thai script does not
  space words. Keep particles (ครับ, ค่ะ, นะ, ไหม), classifiers, and compounds as their own
  segments. Punctuation is not a segment.
- Give each segment an id: \`s0\`, \`s1\`, \`s2\`, restarting at \`s0\` within each line.
- Concatenating every segment's \`thai\` in order must reproduce the line's \`thai\`.
- \`romanization\` is phonetic and readable: mark vowel length (\`aa\` vs \`a\`), use \`bp\` for ป,
  \`dt\` for ต, and \`ng\` for ง. Do not encode tone in the spelling; tone has its own field.
- Split \`syllables\` the way the word is actually pronounced, and give each one its tone.
- \`gloss\` is the segment's meaning on its own, a few words at most.
- \`note\` earns its place or it is null. Use it for register and politeness, idioms that do
  not translate literally, grammar the learner would trip on, and words whose contextual
  meaning differs from the gloss. Do not restate the gloss.

\`summary\` is one or two sentences on who is speaking to whom, the register, and anything
notable about the exchange as a whole.`

export function breakdownPrompt(translation: Translation): string {
  return `Break down this Thai text:\n\n${translation.sourceText}`
}

export const CLARIFICATION_SYSTEM = `You answer follow-up questions from an English-speaking
learner about a specific part of a Thai dialog they are studying.

You are given the full dialog for context and the exact selection they asked about. Answer
that question about that selection. Be direct and concrete: examples and contrasts beat
abstract grammar description. Use Thai script with romanization whenever you cite Thai.

Keep it to a few short paragraphs. Plain prose — no headings. Markdown emphasis and lists
are fine where they genuinely help.`

export function clarificationPrompt(
  clarification: Clarification,
  translation: Translation,
): string {
  const line = translation.lines.find((candidate) => candidate.id === clarification.lineId)
  const selection = selectionOf(line, clarification.segmentIds)

  return [
    'Full dialog:',
    '',
    translation.sourceText,
    '',
    line ? `Line in question: ${line.thai}\nMeaning: ${line.translation}` : '',
    '',
    `They selected: ${selection}`,
    '',
    `Their question: ${clarification.question}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function selectionOf(line: Line | undefined, segmentIds: string[]): string {
  if (!line) return 'the whole dialog'
  if (segmentIds.length === 0) return `the whole line — ${line.thai}`

  const chosen = line.segments.filter((segment) => segmentIds.includes(segment.id))
  if (chosen.length === 0) return `the whole line — ${line.thai}`

  return chosen
    .map((segment) => `${segment.thai} (${segment.romanization}, "${segment.gloss}")`)
    .join(' + ')
}
