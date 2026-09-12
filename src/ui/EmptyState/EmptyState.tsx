import type { ReactNode } from 'react'
import { cx } from '../cx'
import styles from './EmptyState.module.css'

export interface EmptyStateProps {
  title: ReactNode
  description?: ReactNode
  /** e.g. a Button to create the first item, or retry an action. */
  action?: ReactNode
  className?: string
}

// No Base UI primitive for this - a plain, tokens-only layout used for
// "no dialogues" / "no API key configured" and similar placeholders.
export function EmptyState({
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cx(styles.root, className)}>
      <p className={styles.title}>{title}</p>
      {description !== undefined && (
        <p className={styles.description}>{description}</p>
      )}
      {action !== undefined && <div className={styles.action}>{action}</div>}
    </div>
  )
}
