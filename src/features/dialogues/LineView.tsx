import type { LineAnnotation } from '../../llm/schema'
import type { SplitLine } from '../../llm/split'
import type { LineStatus } from '../annotate/useAnnotate'
import { Spinner } from '../../ui'
import { WordChip } from './WordChip'
import styles from './LineView.module.css'

export interface LineViewProps {
  splitLine: SplitLine
  line: LineAnnotation | null
  status: LineStatus
  error: string | null
  showRomanization: boolean
  showGloss: boolean
  toneColors: boolean
}

/**
 * One dialogue line (PLAN.MD §4.3): speaker label, word chips per sentence,
 * the sentence translation underneath, and sentence-level notes in a
 * collapsible row. Falls back to the raw split text (with a pending/error
 * indicator) until the line has finished annotating.
 */
export function LineView({
  splitLine,
  line,
  status,
  error,
  showRomanization,
  showGloss,
  toneColors,
}: LineViewProps) {
  const speaker = line?.speaker ?? splitLine.speaker

  return (
    <li className={styles.line} data-status={status}>
      <div className={styles.speakerRow}>
        {speaker && <span className={styles.speaker}>{speaker}</span>}
        {status === 'pending' && <Spinner size="sm" label="Annotating line" />}
        {status === 'error' && (
          <span className={styles.statusBadge}>Failed</span>
        )}
      </div>

      {line ? (
        <div className={styles.sentences}>
          {line.sentences.map((sentence, sentenceIndex) => (
            <div key={sentenceIndex} className={styles.sentence}>
              <div className={styles.words}>
                {sentence.words.map((word, wordIndex) => (
                  <WordChip
                    key={wordIndex}
                    word={word}
                    showRomanization={showRomanization}
                    showGloss={showGloss}
                    toneColors={toneColors}
                  />
                ))}
              </div>
              <p className={styles.translation}>{sentence.translation}</p>
              {sentence.notes.length > 0 && (
                <details className={styles.notes}>
                  <summary>Notes ({sentence.notes.length})</summary>
                  <ul>
                    {sentence.notes.map((note, noteIndex) => (
                      <li key={noteIndex}>{note.text}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
          {line.notes.length > 0 && (
            <details className={styles.notes}>
              <summary>Line notes ({line.notes.length})</summary>
              <ul>
                {line.notes.map((note, noteIndex) => (
                  <li key={noteIndex}>{note.text}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <>
          <p className={styles.rawThai} lang="th">
            {splitLine.text}
          </p>
          {status === 'error' && error && (
            <p className={styles.errorText}>{error}</p>
          )}
        </>
      )}
    </li>
  )
}
