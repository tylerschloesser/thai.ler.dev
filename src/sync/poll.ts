import type { AnnotationRecord } from '../lib/records'
import { mergeRemoteAnnotation } from '../db/repo'
import { api as defaultApi } from './api'
import type { SyncApi } from './api'

// Per-annotation poller (PLAN.MD §4.2 "Client's part" / §4.5): while a run
// is `queued`/`running`, poll `GET /api/annotation` every 4s and merge the
// result in; if the lease looks stalled (no active runner) and lines
// remain, resume it — at most once a minute per record, so a genuinely
// stuck job doesn't hammer the server. Stops itself once the run reaches a
// terminal state.

const POLL_INTERVAL_MS = 4_000
/** Exported for `src/features/annotate/useAnnotate.ts`'s status derivation, which mirrors this same staleness rule (PLAN.MD §4.4). */
export const STALE_AFTER_MS = 15_000
const RESUME_COOLDOWN_MS = 60_000

export interface PollDeps {
  api?: SyncApi
  now?: () => number
  intervalMs?: number
  staleAfterMs?: number
  resumeCooldownMs?: number
}

interface Watcher {
  tick: () => Promise<void>
  timer: ReturnType<typeof setInterval>
  stopped: boolean
}

const watchers = new Map<string, Watcher>()

function stopWatcher(id: string): void {
  const watcher = watchers.get(id)
  if (!watcher) return
  watcher.stopped = true
  clearInterval(watcher.timer)
  watchers.delete(id)
}

function linesRemain(record: AnnotationRecord): boolean {
  return record.lines.some((line) => line === null)
}

/** Whether `run.leaseUntil` is still in the future - a runner is genuinely holding it right now. */
function hasLiveLease(
  run: Pick<AnnotationRecord['run'], 'leaseUntil'>,
  nowMs: number,
): boolean {
  return run.leaseUntil !== null && Date.parse(run.leaseUntil) > nowMs
}

/**
 * A record is only *actually* finished once no runner can still be holding
 * it: `done`/`cancelled` alone isn't enough, because `POST
 * /api/annotation/cancel` deliberately leaves a *live* lease untouched
 * (`api/annotation/cancel.ts`) so the in-flight step's own final write -
 * which persists whatever lines it actually finished - still has a chance
 * to land before the client stops polling. Stopping on the bare
 * `state: 'cancelled'` used to mean those already-completed lines never
 * reached the UI until some later, unrelated pull.
 *
 * Takes just the `run` fields (not a whole `AnnotationRecord`) so callers
 * that only have those two values on hand - e.g. React state/props, or a
 * `useEffect` dependency list, which must stay primitives rather than a
 * whole object that changes identity on every poll - don't need to
 * construct a fake record just to ask.
 *
 * Exported so `src/features/dialogues/DialogueView.tsx`'s resume-on-open
 * watch effect can use the exact same rule for its own guard, rather than
 * a second hand-written `state ∈ {...}` list that could drift from this
 * one (which is precisely the bug this was added to fix).
 */
export function isTerminal(
  run: Pick<AnnotationRecord['run'], 'state' | 'leaseUntil'>,
  nowMs: number,
): boolean {
  const finished = run.state === 'done' || run.state === 'cancelled'
  return finished && !hasLiveLease(run, nowMs)
}

/**
 * Whether a `queued`/`running` record looks stalled — no runner is
 * currently holding it. A live `leaseUntil` is the normal case (compared
 * straight against `now`, with `staleAfterMs` of grace past expiry). A
 * `queued` record can also have `leaseUntil: null` — the runner never even
 * took the lease yet (e.g. `POST /api/annotate`'s `waitUntil(runStep(...))`
 * never actually started, or crashed before its first write) — PLAN.MD
 * §4.4/§10 "M3": such a record counts as live for `staleAfterMs` after its
 * own `updatedAt`, and stalled afterwards, so `src/features/annotate/
 * useAnnotate.ts`'s status derivation and this resume check share one rule
 * instead of two.
 */
export function isLeaseStalled(
  run: Pick<AnnotationRecord['run'], 'leaseUntil'>,
  updatedAt: string,
  nowMs: number,
  staleAfterMs: number = STALE_AFTER_MS,
): boolean {
  const referenceIso = run.leaseUntil ?? updatedAt
  return nowMs - Date.parse(referenceIso) > staleAfterMs
}

/**
 * Starts polling `id`'s annotation. Returns an unsubscribe function; calling
 * it (or the poller noticing a terminal state on its own) is idempotent.
 * Re-calling `watchAnnotation` for an `id` already being watched replaces
 * the previous watcher rather than running two in parallel.
 */
export function watchAnnotation(id: string, deps: PollDeps = {}): () => void {
  const api = deps.api ?? defaultApi
  const now = deps.now ?? (() => Date.now())
  const intervalMs = deps.intervalMs ?? POLL_INTERVAL_MS
  const staleAfterMs = deps.staleAfterMs ?? STALE_AFTER_MS
  const resumeCooldownMs = deps.resumeCooldownMs ?? RESUME_COOLDOWN_MS

  stopWatcher(id)

  let lastResumeAttemptAt: number | null = null

  async function tick(): Promise<void> {
    const watcher = watchers.get(id)
    if (!watcher || watcher.stopped) return

    let record: AnnotationRecord
    try {
      record = await api.getAnnotation(id)
    } catch {
      return // transient failure — try again next tick
    }
    await mergeRemoteAnnotation(record)

    const nowMs = now()

    if (isTerminal(record.run, nowMs)) {
      stopWatcher(id)
      return
    }

    // A cancelled record with a still-live lease is mid-flight, not
    // stalled - never resume it (that would race the very runner whose
    // final write we're waiting on). Keep polling at the normal cadence
    // instead; the next tick(s) will pick up the runner's own progress and
    // eventually its terminal write (see `isTerminal` above).
    if (record.run.state === 'cancelled') return

    const stalled = isLeaseStalled(
      record.run,
      record.updatedAt,
      nowMs,
      staleAfterMs,
    )

    if (stalled && linesRemain(record)) {
      const cooledDown =
        lastResumeAttemptAt === null ||
        now() - lastResumeAttemptAt >= resumeCooldownMs
      if (cooledDown) {
        lastResumeAttemptAt = now()
        try {
          const outcome = await api.resumeAnnotation(id)
          if (outcome.status === 'started') {
            await mergeRemoteAnnotation(outcome.record)
            if (isTerminal(outcome.record.run, now())) stopWatcher(id)
          }
        } catch {
          // Leave it stalled; the next tick retries once the cooldown passes.
        }
      }
    }
  }

  const timer = setInterval(() => void tick(), intervalMs)
  watchers.set(id, { tick, timer, stopped: false })

  return () => stopWatcher(id)
}

/** Ticks every currently-watched annotation immediately (e2e speed, `.claude/rules/testing.md`). */
export async function pollNow(): Promise<void> {
  await Promise.all([...watchers.values()].map((watcher) => watcher.tick()))
}

/** Test/debug only: stop every active watcher. */
export function stopAllWatchers(): void {
  for (const id of [...watchers.keys()]) stopWatcher(id)
}
