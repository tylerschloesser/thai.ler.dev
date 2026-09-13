import { useEffect } from 'react'
import { Button, Spinner, useToast } from '../../ui'
import { useAnnotate } from './useAnnotate'
import type { AnnotateState } from './useAnnotate'
import styles from './AnnotateStatus.module.css'

const STATE_LABEL: Record<AnnotateState, string> = {
  running: 'Running',
  stalled: 'Stalled',
  failed: 'Failed',
  cancelled: 'Cancelled',
  complete: 'Complete',
}

export interface AnnotateStatusProps {
  dialogueId: string
}

/**
 * "N/M lines" progress for one dialogue's annotation, with cancel and
 * retry actions, driven by the five-state derivation in `useAnnotate.ts`
 * (PLAN.MD §4.4). Self-contained: mounts its own `useAnnotate`, so any page
 * can drop it in with just a dialogue id.
 */
export function AnnotateStatus({ dialogueId }: AnnotateStatusProps) {
  const {
    dialogue,
    total,
    done,
    state,
    isRunning,
    error,
    start,
    retry,
    cancel,
  } = useAnnotate(dialogueId)
  const { add: addToast } = useToast()

  // Surfaces a start/retry/cancel failure through the root Toast provider
  // (.claude/rules/ui.md) — per-line failures are toasted separately by
  // DialogueView from `lineErrors`. A fresh mutation attempt always
  // produces a new `Error` instance, so this fires once per real failure.
  useEffect(() => {
    if (!error) return
    addToast({
      title: 'Could not update the annotation',
      description: error.message,
      type: 'error',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error])

  // Nothing has ever run for this dialogue and nothing is running now -
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

  const showRetry =
    state === 'failed' || state === 'cancelled' || state === 'stalled'
  const showCancel = state === 'running'

  return (
    <div className={styles.root}>
      <p aria-live="polite" className={styles.progress}>
        {state === 'running' && <Spinner size="sm" />}
        {state && <span>{STATE_LABEL[state]}</span>}
        <span>
          {done}/{total} lines
        </span>
      </p>
      <div className={styles.actions}>
        {showCancel && (
          <Button variant="ghost" size="sm" onClick={cancel}>
            Cancel
          </Button>
        )}
        {showRetry && (
          <Button variant="secondary" size="sm" onClick={retry}>
            Retry failed
          </Button>
        )}
      </div>
    </div>
  )
}
