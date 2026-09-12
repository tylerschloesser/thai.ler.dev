import type { WordAnnotation } from '../../llm/schema'
import { Popover } from '../../ui'
import { WordPopover } from './WordPopover'
import styles from './WordChip.module.css'

export interface WordChipProps {
  word: WordAnnotation
  showRomanization: boolean
  showGloss: boolean
  toneColors: boolean
}

/**
 * One word in a `LineView` sentence: Thai on top, romanization/gloss
 * underneath as the display toggles allow (docs/plans/P0.md §4.3). Clicking opens a
 * `WordPopover` with the full syllable/tone/notes breakdown.
 */
export function WordChip({
  word,
  showRomanization,
  showGloss,
  toneColors,
}: WordChipProps) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className={styles.chip}
        render={<button type="button" />}
      >
        <span className={styles.thai} lang="th">
          {word.thai}
        </span>
        {showRomanization && (
          <span className={styles.romanization}>{word.romanization}</span>
        )}
        {showGloss && <span className={styles.gloss}>{word.gloss}</span>}
      </Popover.Trigger>
      <Popover.Popup className={styles.popover}>
        <WordPopover word={word} toneColors={toneColors} />
      </Popover.Popup>
    </Popover.Root>
  )
}
