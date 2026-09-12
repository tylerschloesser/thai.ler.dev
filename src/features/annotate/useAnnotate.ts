import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { buildAnthropicClient } from '../../app/anthropic'
import type { AnnotationRecord, Dialogue } from '../../db/db'
import {
  createAnnotation as repoCreateAnnotation,
  finalizeAnnotation,
  getAnnotation,
  getDialogue,
  setCurrentAnnotation,
  upsertAnnotationLine,
} from '../../db/repo'
import {
  annotateDialogue,
  resumeAnnotation,
  type PipelineOptions,
  type PipelineRepo,
  type PipelineResult,
} from '../../llm/pipeline'
import type { LineAnnotation } from '../../llm/schema'

// ---------------------------------------------------------------------------
// Cross-component run registry
// ---------------------------------------------------------------------------
//
// Composer starts a dialogue's annotation and navigates to /d/$id
// immediately (PLAN.MD §4.3) - the pipeline keeps running after Composer
// unmounts (it's a plain async call, not tied to a component's lifetime).
// DialogueView then mounts its own `useAnnotate(dialogueId)` and must be
// able to (a) observe that a run is already in flight rather than starting
// a duplicate one, and (b) cancel it. `activeRuns` + the tiny pub-sub below
// are the whole mechanism for that; the actual per-line progress is read
// back from Dexie (via `useLiveQuery`), which already updates reactively in
// every component regardless of who started the run.

interface RunEntry {
  controller: AbortController
}

const activeRuns = new Map<string, RunEntry>()
const runListeners = new Map<string, Set<() => void>>()

function notifyRun(dialogueId: string): void {
  for (const listener of runListeners.get(dialogueId) ?? []) listener()
}

function subscribeRun(dialogueId: string, listener: () => void): () => void {
  let set = runListeners.get(dialogueId)
  if (!set) {
    set = new Set()
    runListeners.set(dialogueId, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) runListeners.delete(dialogueId)
  }
}

function isAnnotationRunning(dialogueId: string): boolean {
  return activeRuns.has(dialogueId)
}

/** Aborts the in-flight run for `dialogueId`, if any - a no-op otherwise. */
export function cancelAnnotation(dialogueId: string): void {
  activeRuns.get(dialogueId)?.controller.abort()
}

// ---------------------------------------------------------------------------
// repo.ts -> PipelineRepo adapter
// ---------------------------------------------------------------------------

/**
 * Thin adapter from `src/db/repo.ts` (the only write path to IndexedDB) to
 * the pipeline's `PipelineRepo` interface. Also keeps `dialogue.
 * currentAnnotationId` pointed at the record being written, so any reader
 * (this hook, DialogueList's status chip, DialogueView) can find it via a
 * live query on the dialogue alone.
 */
function toPipelineRepo(dialogueId: string): PipelineRepo {
  return {
    async createAnnotation(input) {
      const record = await repoCreateAnnotation({
        dialogueId: input.dialogueId,
        model: input.model,
        promptVersion: input.promptVersion,
        lineCount: input.lineCount,
      })
      await setCurrentAnnotation(dialogueId, record.id)
      return { annotationId: record.id }
    },
    async upsertLine(input) {
      // `warnings` (invariant-check notes from src/llm/schema.ts) have no
      // home yet - AnnotationRecord (src/db/db.ts) doesn't carry a
      // per-line warnings field. Dropped here rather than invented, since
      // src/db is out of scope for this feature.
      if (input.error !== null) {
        await upsertAnnotationLine(input.annotationId, input.lineIndex, {
          error: input.error,
        })
        return
      }
      if (input.line !== null) {
        await upsertAnnotationLine(input.annotationId, input.lineIndex, {
          line: input.line,
        })
        return
      }
      // Shouldn't happen (pipeline.ts always pairs a null line with a
      // non-null error), but never silently drop a line update.
      await upsertAnnotationLine(input.annotationId, input.lineIndex, {
        error: 'Unknown error (no line and no error reported)',
      })
    },
    async finalize(input) {
      // repo.finalizeAnnotation only ever sets status: 'complete'. A
      // partial result needs no extra write - createAnnotation already
      // left the record at 'partial', and nothing here changes that.
      // Usage/duration aren't persisted: repo.ts exposes no setter for
      // them (out of scope here - src/db is owned by M2/M3).
      if (input.status === 'complete') {
        await finalizeAnnotation(input.annotationId)
      }
    },
  }
}

async function runPipeline(
  dialogueId: string,
  run: (opts: PipelineOptions) => Promise<PipelineResult>,
): Promise<PipelineResult> {
  if (isAnnotationRunning(dialogueId)) {
    throw new Error(
      `An annotation run is already in progress for dialogue "${dialogueId}".`,
    )
  }
  const controller = new AbortController()
  activeRuns.set(dialogueId, { controller })
  notifyRun(dialogueId)
  try {
    const { client, model } = await buildAnthropicClient()
    return await run({
      client,
      model,
      signal: controller.signal,
      repo: toPipelineRepo(dialogueId),
    })
  } finally {
    activeRuns.delete(dialogueId)
    notifyRun(dialogueId)
  }
}

/**
 * Fire-and-forget: starts a fresh annotation for a just-created dialogue.
 * Not a hook - safe to call from an event handler (Composer's submit) and
 * navigate away immediately. Registers the run in the shared registry
 * above so a `useAnnotate(dialogue.id)` mounted after navigation (e.g.
 * DialogueView) observes/cancels this same run instead of starting a
 * duplicate one. Rejects with `MissingApiKeyError` (see src/app/anthropic.ts)
 * if no key is configured - callers should catch that and toast it, since
 * by definition no component showing progress for this dialogue exists yet.
 */
export function startAnnotation(dialogue: {
  id: string
  sourceText: string
}): Promise<PipelineResult> {
  return runPipeline(dialogue.id, (opts) => annotateDialogue(dialogue, opts))
}

// ---------------------------------------------------------------------------
// useAnnotate hook
// ---------------------------------------------------------------------------

export type LineStatus = 'pending' | 'done' | 'error'

function computeLineStatuses(annotation: AnnotationRecord): LineStatus[] {
  return annotation.lines.map((line, index) => {
    if (line !== null) return 'done'
    return annotation.lineErrors[index] !== null ? 'error' : 'pending'
  })
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
  /** True while a run is in flight for this dialogue, in this component or any other. */
  isRunning: boolean
  /** Set when the last start/resume/retry attempt threw (e.g. `MissingApiKeyError`). */
  error: Error | null
  /** Starts a brand-new annotation (only meaningful when `annotation` is undefined, e.g. retrying after a startup failure like a missing API key). */
  start: (sourceText: string) => void
  /** Re-runs every not-yet-successful line of the existing annotation - used for both "resume" (after a cancel) and "retry failed lines": they're the same operation, since a failed line is left `null` exactly like an unattempted one (see src/llm/pipeline.ts's resumeAnnotation). */
  retry: () => void
  /** Cancels the in-flight run, if any. */
  cancel: () => void
}

/**
 * Stateful view of one dialogue's annotation progress, built on a TanStack
 * `useMutation` wrapping `annotateDialogue`/`resumeAnnotation`. Progress
 * (`done`/`total`/`lineStatuses`) is read back from Dexie via
 * `useLiveQuery`, so it stays correct even when this component didn't
 * start the run (e.g. Composer started it, DialogueView is watching it).
 * Auto-resumes once, on mount, whenever it finds a `status: 'partial'`
 * record with no run currently in flight (PLAN.MD §5 M4: "resume-on-open").
 */
export function useAnnotate(dialogueId: string): UseAnnotateResult {
  const dialogue = useLiveQuery(() => getDialogue(dialogueId), [dialogueId])
  const annotationId = dialogue?.currentAnnotationId ?? null
  const annotation = useLiveQuery(
    () => (annotationId ? getAnnotation(annotationId) : undefined),
    [annotationId],
  )

  const externallyRunning = useSyncExternalStore(
    useCallback(
      (onStoreChange) => subscribeRun(dialogueId, onStoreChange),
      [dialogueId],
    ),
    () => isAnnotationRunning(dialogueId),
  )

  const mutation = useMutation({
    mutationFn: async (input: { sourceText: string } | undefined) => {
      if (input) {
        return runPipeline(dialogueId, (opts) =>
          annotateDialogue(
            { id: dialogueId, sourceText: input.sourceText },
            opts,
          ),
        )
      }
      if (!dialogue || !annotation) {
        throw new Error('No annotation to resume for this dialogue yet.')
      }
      return runPipeline(dialogueId, (opts) =>
        resumeAnnotation(
          {
            annotationId: annotation.id,
            sourceText: dialogue.sourceText,
            lines: annotation.lines as Array<LineAnnotation | null>,
          },
          opts,
        ),
      )
    },
  })

  const [autoResumed, setAutoResumed] = useState<string | null>(null)

  useEffect(() => {
    if (!annotation || annotation.status !== 'partial') return
    if (externallyRunning || mutation.isPending) return
    // Only ever auto-fire once per annotation id, so a run that finishes
    // back at 'partial' (e.g. every line failed again) doesn't loop.
    if (autoResumed === annotation.id) return
    setAutoResumed(annotation.id)
    mutation.mutate(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotation?.id, annotation?.status, externallyRunning])

  const total = annotation?.lines.length ?? 0
  const done = annotation
    ? annotation.lines.filter((line) => line !== null).length
    : 0
  const lineStatuses = annotation ? computeLineStatuses(annotation) : []
  const hasFailedLines = lineStatuses.includes('error')

  const start = useCallback(
    (sourceText: string) => mutation.mutate({ sourceText }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dialogueId],
  )
  const retry = useCallback(
    () => mutation.mutate(undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dialogueId],
  )
  const cancel = useCallback(() => cancelAnnotation(dialogueId), [dialogueId])

  return {
    dialogue,
    annotation,
    total,
    done,
    lineStatuses,
    hasFailedLines,
    isRunning: externallyRunning || mutation.isPending,
    error: mutation.error,
    start,
    retry,
    cancel,
  }
}
