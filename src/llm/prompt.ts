import { TONE_RULES, type ToneMark } from '../lib/tone.js'
import type { SplitLine } from './split.js'

/**
 * Bump whenever `SYSTEM_PROMPT` or the zod schema shape changes, and
 * re-run `pnpm gen:fixture` before committing (see .claude/rules/llm.md).
 */
export const PROMPT_VERSION = 2

const TONE_MARK_LABEL: Record<ToneMark, string> = {
  none: '(none)',
  mai_ek: 'mai ek ( ่ )',
  mai_tho: 'mai tho ( ้ )',
  mai_tri: 'mai tri ( ๊ )',
  mai_chattawa: 'mai chattawa ( ๋ )',
}

// Rendered once, from the same data `src/lib/tone.ts` exports, so the
// prompt's tone table and the future UI explainer can never drift apart.
const TONE_TABLE_MARKDOWN = [
  '| Consonant class | Syllable | Tone mark | Tone |',
  '| --- | --- | --- | --- |',
  ...TONE_RULES.map((rule) => {
    const syllable =
      rule.vowelLength === null
        ? rule.syllableWeight
        : `${rule.syllableWeight} (${rule.vowelLength} vowel)`
    return `| ${rule.consonantClass} | ${syllable} | ${TONE_MARK_LABEL[rule.toneMark]} | ${rule.tone} |`
  }),
].join('\n')

export const SYSTEM_PROMPT = `You are a Thai language tutor helping an English-speaking absolute beginner
understand a short, real dialogue one line at a time. You will be given the
full dialogue for context, and asked to annotate exactly one target line.
Respond only with the structured JSON output described by the provided
schema - no prose outside it.

## Segmentation rules

- Segment each sentence into words the way a beginner should learn them:
  particles, classifiers, and compound nouns are each their own word rather
  than being folded into a neighbor.
- Segment each word into syllables the way a Thai reader would pronounce it,
  not by written syllable boundaries alone when they diverge from speech.
- Concatenation invariants must hold: joining every word's \`thai\` field
  (ignoring spaces) must reproduce the sentence's \`thai\` field, and joining
  every syllable's \`thai\` field must reproduce its word's \`thai\` field.
  These are checked automatically after your response, so segment carefully
  rather than truncating or paraphrasing the source text.
- A line may contain more than one sentence; split on clause/sentence
  boundaries the way a beginner learner's material would.

## Romanization (Paiboon-style, with tone diacritics)

- Consonants: write ก as \`g\`, but the *unaspirated* stop pairs use \`bp\` for
  ป and \`dt\` for ต (distinguishing them from the aspirated \`p\`/\`t\`), and ง
  is always written \`ng\` (never \`g\` alone, and never dropped word-initially).
- Vowel length is shown by doubling the vowel letter for long vowels (e.g.
  \`aa\`, \`ii\`, \`uu\`, \`oo\`) and a single letter for short vowels (e.g. \`a\`,
  \`i\`, \`u\`, \`o\`). Never rely on tone marks to imply vowel length.
- Use only plain Latin letters for vowels - never IPA symbols (no \`ɔ\`, \`ɛ\`,
  \`ə\`, \`ɯ\`, etc.). The open-mid back vowel (as in ขอ, น้อย, ขอบคุณ) is
  always spelled with doubled \`o\` (\`oo\`), exactly like \`kǒo\` for ขอ - never
  \`ɔɔ\`/\`ɔ\`. Apply this consistently: the same vowel sound gets the same
  spelling everywhere in the response, in every word it appears in.
- Tone is shown with diacritics on the vowel: \`à\` low, \`â\` falling, \`á\`
  high, \`ǎ\` rising, and **no diacritic at all** for mid tone. Never encode
  tone by altering the consonant spelling (e.g. never write a low-class
  consonant differently to "fake" a tone) - tone is carried purely by the
  vowel diacritic.
- Every syllable gets its own tone per the rule table below; give a short,
  consistent \`toneExplanation\` for each syllable in the form "<class>-class
  initial <consonant> + <live|dead> syllable [+ <tone mark>] -> <tone>".

## Tone rules (consonant class x syllable weight x tone mark -> tone)

${TONE_TABLE_MARKDOWN}

## Note policy

- A note must earn its place: never restate what the \`gloss\`, \`translation\`,
  or \`toneExplanation\` already say.
- Prefer 0-2 notes per word - most words need none. Reach for a note only
  when something would trip up a beginner: an idiom, a false friend, a
  classifier quirk, a spelling/pronunciation mismatch, a register shift, a
  loanword origin, or "this doesn't map cleanly to English".
- Use sentence-level notes for register, usage frequency, or politeness
  observations that apply to the whole sentence rather than one word.
- Pick the single most specific \`kind\` that applies; use \`other\` only when
  nothing else fits.

## Translation style

- \`translation\` fields should read as natural, idiomatic English at the
  sentence level - not a word-for-word gloss.
- Only fill in \`literal\` when a word-by-word rendering actually teaches
  something (e.g. the natural translation hides a classifier, particle, or
  idiom); otherwise leave it null rather than restating the translation.`

interface TextBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

export interface UserMessageBlocks {
  /** Stable per dialogue - byte-identical across every lineIndex, so it hits the prompt cache. */
  dialogueBlock: TextBlock
  /** Varies per call - identifies which line to annotate. */
  targetBlock: TextBlock
}

function renderLine(line: SplitLine): string {
  return line.speaker ? `${line.speaker}: ${line.text}` : line.text
}

function renderDialogueBlock(lines: SplitLine[]): string {
  const body = lines
    .map((line, index) => `[${index}] ${renderLine(line)}`)
    .join('\n')
  return `<dialogue>\n${body}\n</dialogue>`
}

function renderTargetBlock(lines: SplitLine[], lineIndex: number): string {
  const target = lines[lineIndex]
  if (!target) {
    throw new RangeError(
      `lineIndex ${lineIndex} is out of range for a dialogue with ${lines.length} line(s)`,
    )
  }
  return [
    `<target line="${lineIndex}">`,
    renderLine(target),
    '</target>',
    '',
    'Annotate only the target line above. Use the full dialogue only for ' +
      'pronoun resolution, register, and continuity - do not annotate any ' +
      'other line.',
  ].join('\n')
}

/**
 * Builds the two user-message content blocks for annotating one line, per
 * docs/plans/P0.md §4.2's prompt-caching layout: the full dialogue first (stable per
 * dialogue - the second cache breakpoint after the system prompt), then the
 * target-line instruction (varies per call, not cached).
 */
export function buildUserMessage(
  lines: SplitLine[],
  lineIndex: number,
): UserMessageBlocks {
  return {
    dialogueBlock: {
      type: 'text',
      text: renderDialogueBlock(lines),
      cache_control: { type: 'ephemeral' },
    },
    targetBlock: {
      type: 'text',
      text: renderTargetBlock(lines, lineIndex),
    },
  }
}
