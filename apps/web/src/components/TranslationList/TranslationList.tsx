import { Link } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { StatusPill } from '../StatusPill/StatusPill.tsx'
import { translations } from '../../db/collections.ts'
import styles from './TranslationList.module.css'

export function TranslationList() {
  const { data, isLoading, isError } = useLiveQuery({
    query: (q) => q.from({ row: translations }).orderBy(({ row }) => row.createdAt, 'desc'),
  })

  // Collection lifecycle, distinct from route loading and from any row's own
  // status. Order matters here: rows we already have win over both.
  //
  // Offline, the refresh behind this list always fails while the persisted
  // cache still holds everything worth reading. Letting `isError` outrank the
  // data would replace a perfectly good list with an error banner every time
  // the network drops — so a failed *refresh* is silent, and the error only
  // surfaces when there is genuinely nothing to show instead.
  if (data.length === 0) {
    if (isLoading) {
      return (
        <output className={styles.note} aria-live="polite">
          Loading your translations…
        </output>
      )
    }

    if (isError) {
      return (
        <div className={styles.note} role="alert">
          <p className={styles.noteText}>Couldn&rsquo;t load your translations.</p>
          <button
            type="button"
            className={styles.retry}
            onClick={() => void translations.utils.clearError()}
          >
            Try again
          </button>
        </div>
      )
    }

    return <p className={styles.note}>Nothing yet. Paste some Thai above to get started.</p>
  }

  return (
    <ul className={styles.list}>
      {data.map((row) => (
        <li key={row.id}>
          <Link
            to="/translations/$id"
            params={{ id: row.id }}
            className={styles.card}
            aria-label={`Open translation: ${row.sourceText.slice(0, 60)}`}
          >
            <p className={styles.source} lang="th">
              {row.sourceText}
            </p>
            <div className={styles.meta}>
              <StatusPill status={row.status} />
              <time className={styles.time} dateTime={new Date(row.createdAt).toISOString()}>
                {formatDate(row.createdAt)}
              </time>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

const FORMATTER = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatDate(ms: number): string {
  return FORMATTER.format(new Date(ms))
}
