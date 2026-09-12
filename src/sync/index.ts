import { SETTINGS_RECORD_ID } from '../lib/records'
import { settingsUpdatedAt } from '../lib/merge'
import { nowIso } from '../lib/time'
import { db } from '../db/db'
import { enqueueOutbox } from '../db/repo'
import {
  getLastPullAt,
  getSyncInitialized,
  setSyncInitialized,
} from '../db/meta'
import { pull } from './pull'
import { push } from './push'
import type { PullDeps } from './pull'
import type { PushDeps } from './push'

export { pull } from './pull'
export { push } from './push'
export { pollNow, watchAnnotation } from './poll'
export { api, ApiError, createApi } from './api'
export type { SyncApi } from './api'

const PUSH_DEBOUNCE_MS = 500

/**
 * Exponential backoff for a failed (non-offline) push retry: 30s, 60s,
 * 120s, then capped at 5 minutes. Indexed by the number of consecutive
 * failures since the last successful push.
 */
const RETRY_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000]

export interface StartSyncDeps extends PullDeps, PushDeps {
  /** Overridable for tests only — real callers keep the 500ms default. */
  pushDebounceMs?: number
  /** Overridable for tests only — real callers keep the 30s/60s/120s/300s default. */
  retryBackoffMs?: number[]
}

/**
 * First run after the Dexie v2 upgrade (`meta.syncInitialized` absent):
 * enqueues every local dialogue/annotation/settings row so an existing
 * (pre-sync) library gets pushed to the server once `startSync` calls
 * `push()`. Idempotent — a no-op once `syncInitialized` is set.
 */
async function enqueueEverythingOnFirstRun(): Promise<void> {
  if (await getSyncInitialized()) return

  await db.transaction(
    'rw',
    db.dialogues,
    db.annotations,
    db.settings,
    db.outbox,
    async () => {
      const [dialogues, annotations, settings] = await Promise.all([
        db.dialogues.toArray(),
        db.annotations.toArray(),
        db.settings.toArray(),
      ])

      for (const dialogue of dialogues) {
        await enqueueOutbox('dialogue', dialogue.id, dialogue.updatedAt)
      }
      for (const annotation of annotations) {
        await enqueueOutbox('annotation', annotation.id, annotation.updatedAt)
      }
      if (settings.length > 0) {
        await enqueueOutbox(
          'settings',
          SETTINGS_RECORD_ID,
          settingsUpdatedAt(settings, nowIso()),
        )
      }
    },
  )

  await setSyncInitialized()
}

interface Debounced {
  run: () => void
  /** Cancels a pending, not-yet-fired call. Idempotent. */
  cancel: () => void
}

function debounce(fn: () => void, ms: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    run: () => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(fn, ms)
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}

let currentStop: (() => void) | null = null

/**
 * Starts the client sync loop (PLAN.MD §4.5): the first-run outbox seed
 * above, then pull -> push once immediately; pulls (and retries a push)
 * again on `visibilitychange` -> visible and on the `online` event; pushes
 * (debounced 500ms) after any outbox write. That's both a `creating` *and*
 * an `updating` Dexie hook on `outbox` — `enqueueOutbox` uses `put`, so a
 * write to a key that's already queued (a push in flight, or a previous
 * `PUT` that failed and left the row behind) fires `updating`, not
 * `creating`, and must schedule a push too.
 *
 * A finished push's `failed` (`src/sync/push.ts`) decides what happens
 * next — this is what keeps a dead network or a down API from turning into
 * a `PUT` every 500ms forever:
 *   - `null` (every attempted `PUT` succeeded): reset the retry backoff; if
 *     `remaining > 0` (a write landed mid-push, so `clearOutbox` declined
 *     to delete it — see `src/db/repo.ts`), schedule one more debounced
 *     push so it isn't left stranded.
 *   - `'offline'`: schedule nothing. The `online`/`visibilitychange`
 *     listeners (or the next outbox write) are what trigger the next
 *     attempt.
 *   - `'error'` (a non-network failure, e.g. a 5xx): schedule exactly one
 *     retry with exponential backoff (30s/60s/120s, capped at 5 min); a
 *     fresh outbox write still debounces normally, but never stacks a
 *     second concurrent backoff timer.
 *
 * Idempotent — calling it again while already running returns the same
 * stop function without starting a second loop, and `stop()` cancels both
 * the debounce and any pending backoff retry. Safe outside a browser (e.g.
 * Vitest): `visibilitychange`/`online` listeners are only attached when
 * `document`/`window` exist.
 */
export function startSync(deps: StartSyncDeps = {}): () => void {
  if (currentStop) return currentStop

  const pushDebounceMs = deps.pushDebounceMs ?? PUSH_DEBOUNCE_MS
  const retryBackoffMs = deps.retryBackoffMs ?? RETRY_BACKOFF_MS

  let stopped = false
  let retryAttempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const triggerPush = debounce(() => {
    void runPush()
  }, pushDebounceMs)

  function cancelRetry(): void {
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
  }

  /** Schedules one retry, unless one is already pending — never stacks a second. */
  function scheduleRetry(): void {
    if (stopped || retryTimer !== null) return
    const delay =
      retryBackoffMs[Math.min(retryAttempt, retryBackoffMs.length - 1)]
    retryAttempt += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      void runPush()
    }, delay)
  }

  async function runPush(): Promise<void> {
    if (stopped) return
    const { remaining, failed } = await push(deps)
    if (stopped) return

    if (failed === null) {
      retryAttempt = 0
      cancelRetry()
      if (remaining > 0) triggerPush.run()
      return
    }
    if (failed === 'error') {
      scheduleRetry()
    }
    // failed === 'offline': nothing scheduled here on purpose — see the
    // doc comment above.
  }

  function onOutboxWrite(): void {
    if (!stopped) triggerPush.run()
  }
  db.outbox.hook('creating', onOutboxWrite)
  db.outbox.hook('updating', onOutboxWrite)

  const hasDocument = typeof document !== 'undefined'
  const hasWindow = typeof window !== 'undefined'

  function onVisibilityChange(): void {
    if (stopped) return
    if (document.visibilityState === 'visible') {
      void pull(deps)
      void runPush()
    }
  }
  function onOnline(): void {
    if (stopped) return
    void pull(deps)
    void runPush()
  }

  if (hasDocument)
    document.addEventListener('visibilitychange', onVisibilityChange)
  if (hasWindow) window.addEventListener('online', onOnline)

  void (async () => {
    await enqueueEverythingOnFirstRun()
    if (stopped) return
    await pull(deps)
    if (stopped) return
    await runPush()
  })()

  function stop(): void {
    stopped = true
    currentStop = null
    triggerPush.cancel()
    cancelRetry()
    db.outbox.hook.creating.unsubscribe(onOutboxWrite)
    db.outbox.hook.updating.unsubscribe(onOutboxWrite)
    if (hasDocument)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    if (hasWindow) window.removeEventListener('online', onOnline)
  }

  currentStop = stop
  return stop
}

export interface SyncStatus {
  lastPullAt: string | null
  pendingPushes: number
}

/** Point-in-time sync status, for `window.__thai.sync.status()` and `useSync`. */
export async function status(): Promise<SyncStatus> {
  const [lastPullAt, pendingPushes] = await Promise.all([
    getLastPullAt(),
    db.outbox.count(),
  ])
  return { lastPullAt, pendingPushes }
}
