import type { SyllableAnnotation } from '../../llm/schema'
import { ToneBadge } from './ToneBadge'
import styles from './SyllableRow.module.css'

export interface SyllableRowProps {
  syllable: SyllableAnnotation
  toneColors: boolean
}

/** One syllable inside `WordPopover`: Thai, romanization, `ToneBadge`, and
 * the "why this tone" explanation from the LLM output (PLAN.MD §4.3). */
export function SyllableRow({ syllable, toneColors }: SyllableRowProps) {
  return (
    <li className={styles.row}>
      <span className={styles.thai} lang="th">
        {syllable.thai}
      </span>
      <span className={styles.romanization}>{syllable.romanization}</span>
      <ToneBadge tone={syllable.tone} toneColors={toneColors} />
      {syllable.meaning && (
        <span className={styles.meaning}>"{syllable.meaning}"</span>
      )}
      {syllable.toneExplanation && (
        <p className={styles.explanation}>{syllable.toneExplanation}</p>
      )}
    </li>
  )
}
