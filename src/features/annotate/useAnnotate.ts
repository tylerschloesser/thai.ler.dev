import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import type { AnnotationRecord, Dialogue } from '../../db/db'
import {
  getAnnotation,
  getDialogue,
  mergeRemoteAnnotation,
  mergeRemoteDialogue,
} from '../../db/repo'
import { getSetting } from '../../db/settings'
import { api, ApiError } from '../../sync/api'
import { isLeaseStalled } from '../../sync/poll'

// ---------------------------------------------------------------------------
// Job client (PLAN.MD §4.5, M3) — replaces the P0 in-browser pipeline.
// Annotation now runs server-side (`api/_lib/runner.ts`); this module's job
// is POST/merge, not run-the-model-itself. `src/sync/poll.ts`'s
// `watchAnnotation`/`pollNow` are what keep a record's `run` fresh while a
// job is in flight — `DialogueView` starts that watcher (resume-on-open),
// not this hook.
// ---------------------------------------------------------------------------

export type LineStatus = 'pending' | 'done' | 'error'

function computeLineStatuses(annotation: AnnotationRecord): LineStatus[] {
  return annotation.lines.map((line, index) => {
    if (line !== null) return 'done'
    return annotation.lineErrors[index] !== null ? 'error' : 'pending'
  })
}

export type AnnotateState =
  'running' | 'stalled' | 'failed' | 'cancelled' | 'complete'

/**
 * Five-state UI derivation from an `AnnotationRecord.run` (PLAN.MD §4.4):
 * `running` = state `queued`/`running` with a live lease; `stalled` = same
 * states with an expired lease (or, for a `leaseUntil: null` job whose
 * runner never even took the lease, an `updatedAt` older than 15s — see
 * `src/sync/poll.ts`'s `isLeaseStalled`, which this mirrors exactly) and
 * lines still remaining; `failed` = `done` + `partial`; `cancelled`;
 * `complete` = `done` + `complete`.
 */
export function deriveAnnotateState(
  annotation: AnnotationRecord,
  nowMs: number = Date.now(),
): AnnotateState {
  const { run, status } = annotation
  if (run.state === 'cancelled') return 'cancelled'
  if (run.state === 'done') {
    return status === 'complete' ? 'complete' : 'failed'
  }
  const linesRemain = annotation.lines.some((line) => line === null)
  const stalled = isLeaseStalled(run, annotation.updatedAt, nowMs)
  return stalled && linesRemain ? 'stalled' : 'running'
}

/**
 * The dialogue passed to `startAnnotation` already exists locally (created
 * via `repo.createDialogue`, outbox as usual, by whichever caller — today
 * that's always Composer or DialogueView) — but never crash rather than
 * send `POST /api/annotate` a malformed record if it somehow doesn't.
 */
async function loadLocalDialogue(
  id: string,
  sourceText: string,
): Promise<Dialogue> {
  const existing = await getDialogue(id)
  if (existing) return existing
  const now = new Date().toISOString()
  return {
    id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    title: sourceText.slice(0, 80),
    sourceText,
    currentAnnotationId: null,
  }
}

function toFriendlyError(err: unknown): Error {
  if (err instanceof ApiError && err.kind === 'offline') {
    return new Error('Annotation needs a connection')
  }
  return err instanceof Error ? err : new Error('Unknown error')
}

/**
 * Fire-and-forget: starts a fresh annotation for a dialogue that already
 * exists locally. Keeps the same `{ id, sourceText }` signature Composer and
 * DialogueView called the P0 pipeline with — only what happens next
 * changed: `POST /api/annotate` (with the current Settings model), merge
 * both returned records in via `repo.mergeRemote*`, return the merged
 * annotation. Callers navigate to `/d/$id` themselves, same as before
 * (PLAN.MD §4.5). An offline `ApiError` becomes a plain `Error` reading
 * "Annotation needs a connection", so existing `.catch(err => toast(err.
 * message))` call sites need no changes to surface it.
 */
export async function startAnnotation(dialogue: {
  id: string
  sourceText: string
}): Promise<AnnotationRecord> {
  const [local, model] = await Promise.all([
    loadLocalDialogue(dialogue.id, dialogue.sourceText),
    getSetting('model'),
  ])
  try {
    const result = await api.annotate({ dialogue: local, model })
    await mergeRemoteDialogue(result.dialogue)
    return await mergeRemoteAnnotation(result.annotation)
  } catch (err) {
    throw toFriendlyError(err)
  }
}

export interface UseAnnotateResult {
  dialogue: Dialogue | undefined
  annotation: AnnotationRecord | undefined
  /** Total line count, 0 until the annotation record exists. */
  total: number
  /** Lines that finished successfully. */
  done: number
  /** Index-aligned with `annotation.lines`. */
  lineStatuses: LineStatus[]
  hasFailedLines: boolean
  /** `null` until an annotation exists for this dialogue. */
  state: AnnotateState | null
  /** True while `state === 'running'`, or a start/retry call is in flight. */
  isRunning: boolean
  /** Set when the last start/retry/cancel attempt threw. */
  error: Error | null
  /** Starts a brand-new annotation (only meaningful when `annotation` is undefined). */
  start: (sourceText: string) => void
  /** Re-runs every not-yet-successful line — resume after a cancel/stall, or retry failed lines (the server treats these the same). */
  retry: () => void
  /** Cancels the in-flight run, if any. */
  cancel: () => void
}

/**
 * Stateful view of one dialogue's annotation progress. Progress
 * (`done`/`total`/`lineStatuses`/`state`) is read back from Dexie via
 * `useLiveQuery`, kept fresh by `src/sync/poll.ts`'s `watchAnnotation`
 * (started by `DialogueView`, not here) merging polled records in.
 */
export function useAnnotate(dialogueId: string): UseAnnotateResult {
  const dialogue = useLiveQuery(() => getDialogue(dialogueId), [dialogueId])
  const annotationId = dialogue?.currentAnnotationId ?? null
  const annotation = useLiveQuery(
    () => (annotationId ? getAnnotation(annotationId) : undefined),
    [annotationId],
  )

  const startMutation = useMutation({
    mutationFn: (sourceText: string) =>
      startAnnotation({ id: dialogueId, sourceText }),
  })

  const retryMutation = useMutation({
    mutationFn: async () => {
      if (!annotation) {
        throw new Error('No annotation to resume for this dialogue yet.')
      }
      const outcome = await api.resumeAnnotation(annotation.id)
      if (outcome.status === 'busy') {
        throw new Error('This annotation is already running.')
      }
      return mergeRemoteAnnotation(outcome.record)
    },
  })

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!annotation) return undefined
      const record = await api.cancelAnnotation(annotation.id)
      return mergeRemoteAnnotation(record)
    },
  })

  const total = annotation?.lines.length ?? 0
  const done = annotation
    ? annotation.lines.filter((line) => line !== null).length
    : 0
  const lineStatuses = annotation ? computeLineStatuses(annotation) : []
  const hasFailedLines = lineStatuses.includes('error')
  const state = annotation ? deriveAnnotateState(annotation) : null

  const start = useCallback(
    (sourceText: string) => startMutation.mutate(sourceText),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dialogueId],
  )
  const retry = useCallback(
    () => retryMutation.mutate(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dialogueId],
  )
  const cancel = useCallback(
    () => cancelMutation.mutate(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dialogueId],
  )

  return {
    dialogue,
    annotation,
    total,
    done,
    lineStatuses,
    hasFailedLines,
    state,
    isRunning: state === 'running' || startMutation.isPending,
    error: startMutation.error ?? retryMutation.error ?? cancelMutation.error,
    start,
    retry,
    cancel,
  }
}
