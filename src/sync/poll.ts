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

function isTerminal(record: AnnotationRecord): boolean {
  return record.run.state === 'done' || record.run.state === 'cancelled'
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

    if (isTerminal(record)) {
      stopWatcher(id)
      return
    }

    const stalled = isLeaseStalled(
      record.run,
      record.updatedAt,
      now(),
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
            if (isTerminal(outcome.record)) stopWatcher(id)
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
