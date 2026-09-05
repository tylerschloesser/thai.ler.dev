import type { RowStatus } from '@thai/schema'
import styles from './StatusPill.module.css'

const LABELS: Record<RowStatus, string> = {
  pending: 'Working',
  ready: 'Ready',
  failed: 'Failed',
}

/**
 * Renders a row's own `status` field. There is no React state behind this —
 * which is why it reads correctly straight after a reload, and why a row that
 * was still working when the tab closed is still working when it reopens.
 */
export function StatusPill({ status }: { status: RowStatus }) {
  if (status === 'ready') return null

  return (
    <span className={styles.pill} data-status={status}>
      {status === 'pending' ? <span className={styles.dot} aria-hidden="true" /> : null}
      {LABELS[status]}
    </span>
  )
}
