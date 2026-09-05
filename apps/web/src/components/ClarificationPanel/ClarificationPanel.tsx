import { Field } from '@base-ui/react/field'
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/react-db'
import { useState, type FormEvent } from 'react'
import type { Clarification, Translation } from '@thai/schema'
import { Button } from '../Button/Button.tsx'
import { StatusPill } from '../StatusPill/StatusPill.tsx'
import {
  askClarification,
  deleteClarification,
  retryClarification,
} from '../../db/actions.ts'
import { clarifications } from '../../db/collections.ts'
import type { Selection } from '../TranslationDetail/TranslationDetail.tsx'
import styles from './ClarificationPanel.module.css'

export function ClarificationPanel({
  translation,
  selection,
  onClear,
}: {
  translation: Translation
  selection: Selection | null
  onClear: () => void
}) {
  const [question, setQuestion] = useState('')

  const { data } = useLiveQuery({
    query: (q) =>
      q
        .from({ row: clarifications })
        .where(({ row }) => eq(row.translationId, translation.id))
        .orderBy(({ row }) => row.createdAt, 'desc'),
  })

  const trimmed = question.trim()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!trimmed) return

    askClarification({
      translationId: translation.id,
      lineId: selection?.lineId ?? translation.lines[0]?.id ?? '',
      segmentIds: selection?.segmentIds ?? [],
      question: trimmed,
    })

    setQuestion('')
    onClear()
  }

  return (
    <section className={styles.root}>
      <h2 className={styles.heading}>Ask about it</h2>

      <form className={styles.form} onSubmit={submit}>
        <p className={styles.selection}>
          {selection ? (
            <>
              Asking about{' '}
              <span className={styles.selectionText} lang="th">
                {describeSelection(translation, selection)}
              </span>{' '}
              <button type="button" className={styles.clear} onClick={onClear}>
                clear
              </button>
            </>
          ) : (
            'Select words above to ask about them, or just ask about the whole dialog.'
          )}
        </p>

        <Field.Root className={styles.field}>
          <Field.Label className={styles.srOnly} htmlFor="question">
            Your question
          </Field.Label>
          <Field.Control
            id="question"
            className={styles.input}
            value={question}
            placeholder="Why ค่ะ here and not ครับ?"
            onChange={(event) => setQuestion(event.target.value)}
          />
        </Field.Root>

        <Button type="submit" variant="solid" disabled={!trimmed}>
          Ask
        </Button>
      </form>

      {data.length > 0 ? (
        <ul className={styles.list}>
          {data.map((row) => (
            <li key={row.id}>
              <ClarificationCard clarification={row} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function ClarificationCard({ clarification }: { clarification: Clarification }) {
  return (
    <article className={styles.card}>
      <header className={styles.cardHeader}>
        <p className={styles.question}>{clarification.question}</p>
        <div className={styles.cardMeta}>
          <StatusPill status={clarification.status} />
          <Button variant="quiet" onClick={() => deleteClarification(clarification.id)}>
            Delete
          </Button>
        </div>
      </header>

      {clarification.status === 'pending' ? (
        <output className={styles.pending} aria-live="polite">
          Thinking…
        </output>
      ) : null}

      {clarification.status === 'failed' ? (
        <div className={styles.failed} role="alert">
          <p className={styles.failedText}>
            {clarification.error ?? 'That question failed.'}
          </p>
          <Button onClick={() => retryClarification(clarification.id)}>Try again</Button>
        </div>
      ) : null}

      {clarification.answer ? (
        <p className={styles.answer}>{clarification.answer}</p>
      ) : null}
    </article>
  )
}

function describeSelection(translation: Translation, selection: Selection): string {
  const line = translation.lines.find((candidate) => candidate.id === selection.lineId)
  if (!line) return 'this dialog'

  const chosen = line.segments.filter((segment) =>
    selection.segmentIds.includes(segment.id),
  )
  return chosen.length > 0 ? chosen.map((segment) => segment.thai).join(' ') : line.thai
}
