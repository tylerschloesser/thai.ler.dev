import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import type { Translation } from '@thai/schema'
import { Button } from '../Button/Button.tsx'
import { ClarificationPanel } from '../ClarificationPanel/ClarificationPanel.tsx'
import { LineView } from '../LineView/LineView.tsx'
import { StatusPill } from '../StatusPill/StatusPill.tsx'
import { deleteTranslation, retryTranslation } from '../../db/actions.ts'
import styles from './TranslationDetail.module.css'

export type Selection = {
  lineId: string
  segmentIds: string[]
}

export function TranslationDetail({ translation }: { translation: Translation }) {
  const navigate = useNavigate()
  const [selection, setSelection] = useState<Selection | null>(null)

  function remove() {
    deleteTranslation(translation.id)
    void navigate({ to: '/' })
  }

  return (
    <article className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.source} lang="th">
            {translation.sourceText}
          </p>
          {translation.summary ? (
            <p className={styles.summary}>{translation.summary}</p>
          ) : null}
        </div>
        <div className={styles.headerMeta}>
          <StatusPill status={translation.status} />
          <Button variant="quiet" onClick={remove}>
            Delete
          </Button>
        </div>
      </header>

      {/* Each status is its own surface. The pending case is not a spinner over
          nothing — the source text is already above, so there is real content
          while the model works. */}
      {translation.status === 'pending' ? (
        <output className={styles.pending} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          Breaking it down. This keeps going if you close the tab.
        </output>
      ) : null}

      {translation.status === 'failed' ? (
        <div className={styles.failed} role="alert">
          <p className={styles.failedText}>
            {translation.error ?? 'The breakdown failed.'}
          </p>
          <Button onClick={() => retryTranslation(translation.id)}>Try again</Button>
        </div>
      ) : null}

      {translation.status === 'ready' ? (
        <>
          <ol className={styles.lines}>
            {translation.lines.map((line) => (
              <li key={line.id}>
                <LineView
                  line={line}
                  selection={selection?.lineId === line.id ? selection : null}
                  onSelectionChange={setSelection}
                />
              </li>
            ))}
          </ol>

          <ClarificationPanel
            translation={translation}
            selection={selection}
            onClear={() => setSelection(null)}
          />
        </>
      ) : null}
    </article>
  )
}
