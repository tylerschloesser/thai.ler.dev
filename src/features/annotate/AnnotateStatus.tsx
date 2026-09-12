import { Link } from '@tanstack/react-router'
import { MissingApiKeyError } from '../../app/anthropic'
import { Button, EmptyState, Spinner } from '../../ui'
import { useAnnotate } from './useAnnotate'
import styles from './AnnotateStatus.module.css'

export interface AnnotateStatusProps {
  dialogueId: string
}

/**
 * "N/M lines" progress for one dialogue's annotation, with cancel and
 * retry-failed actions. Self-contained: mounts its own `useAnnotate`, so
 * any page can drop it in with just a dialogue id (PLAN.MD §4.3).
 */
export function AnnotateStatus({ dialogueId }: AnnotateStatusProps) {
  const {
    dialogue,
    total,
    done,
    isRunning,
    hasFailedLines,
    error,
    start,
    retry,
    cancel,
  } = useAnnotate(dialogueId)

  if (error instanceof MissingApiKeyError) {
    return (
      <EmptyState
        className={styles.root}
        title="No API key configured"
        description="Add an Anthropic API key in Settings to annotate this dialogue."
        action={
          <Button variant="primary" size="sm" render={<Link to="/settings" />}>
            Go to Settings
          </Button>
        }
      />
    )
  }

  // Nothing has ever run for this dialogue and nothing is running now
  // (e.g. Composer's fire-and-forget call somehow never reached here) -
  // offer a manual way to kick it off rather than showing nothing.
  if (total === 0 && !isRunning) {
    if (!dialogue) return null
    return (
      <div className={styles.root}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => start(dialogue.sourceText)}
        >
          Start annotation
        </Button>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <p aria-live="polite" className={styles.progress}>
        {isRunning && <Spinner size="sm" />}
        <span>
          {done}/{total} lines
        </span>
      </p>
      <div className={styles.actions}>
        {isRunning && (
          <Button variant="ghost" size="sm" onClick={cancel}>
            Cancel
          </Button>
        )}
        {!isRunning && hasFailedLines && (
          <Button variant="secondary" size="sm" onClick={retry}>
            Retry failed
          </Button>
        )}
      </div>
    </div>
  )
}
