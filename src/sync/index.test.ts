import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { createDialogue, renameDialogue, takeOutbox } from '../db/repo'
import { setSetting } from '../db/settings'
import { getSyncInitialized } from '../db/meta'
import { startSync } from './index'
import type { StartSyncDeps } from './index'
import { ApiError } from './api'
import type { SyncApi } from './api'
import type { Manifest, RecordKind } from '../lib/records'

function stubApi(overrides: Partial<SyncApi> = {}): SyncApi {
  return {
    getManifest: async (): Promise<Manifest> => ({
      format: 'thai.ler.dev/manifest',
      version: 1,
      updatedAt: 'x',
      entries: {},
    }),
    getRecord: async () => {
      throw new Error('not stubbed')
    },
    putRecord: async (_kind: RecordKind, record: unknown) => record,
    getAnnotation: async () => {
      throw new Error('not stubbed')
    },
    annotate: async () => {
      throw new Error('not stubbed')
    },
    resumeAnnotation: async () => {
      throw new Error('not stubbed')
    },
    cancelAnnotation: async () => {
      throw new Error('not stubbed')
    },
    rebuildManifest: async () => {
      throw new Error('not stubbed')
    },
    ...overrides,
  }
}

let stop: (() => void) | null = null

beforeEach(async () => {
  await db.dialogues.clear()
  await db.annotations.clear()
  await db.settings.clear()
  await db.outbox.clear()
  await db.meta.clear()
})

afterEach(() => {
  stop?.()
  stop = null
})

describe('startSync', () => {
  it('on first run, enqueues every local record, marks syncInitialized, and drains them via push', async () => {
    await createDialogue('Hello')
    await setSetting('theme', 'dark')
    const pushedKinds: RecordKind[] = []
    const deps: StartSyncDeps = {
      api: stubApi({
        putRecord: async (kind, record) => {
          pushedKinds.push(kind)
          return record
        },
      }),
    }

    stop = startSync(deps)

    await expect.poll(() => getSyncInitialized()).toBe(true)
    await expect.poll(() => takeOutbox().then((rows) => rows.length)).toBe(0)
    expect(pushedKinds.sort()).toEqual(['dialogue', 'settings'])
  })

  it('is idempotent: a second call returns the same stop function and does not double-start', async () => {
    const deps: StartSyncDeps = { api: stubApi() }
    stop = startSync(deps)
    const second = startSync(deps)
    expect(second).toBe(stop)
  })

  it('does not enqueue anything on a second startSync (syncInitialized already set)', async () => {
    await createDialogue('First device state')
    const deps: StartSyncDeps = { api: stubApi() }
    stop = startSync(deps)
    await expect.poll(() => getSyncInitialized()).toBe(true)
    await expect.poll(() => takeOutbox().then((rows) => rows.length)).toBe(0)
    stop()
    stop = null

    // A brand-new dialogue after the first run's outbox has drained.
    await createDialogue('Second dialogue')
    const rowsBeforeRestart = await takeOutbox()
    expect(rowsBeforeRestart).toHaveLength(1) // from createDialogue itself, not from startSync

    stop = startSync({ api: stubApi() })
    await expect.poll(() => takeOutbox().then((rows) => rows.length)).toBe(0)
  })

  it('pushes (debounced) after any outbox write once running', async () => {
    const pushedKinds: RecordKind[] = []
    stop = startSync({
      api: stubApi({
        putRecord: async (kind, record) => {
          pushedKinds.push(kind)
          return record
        },
      }),
    })
    await expect.poll(() => getSyncInitialized()).toBe(true)
    pushedKinds.length = 0

    await createDialogue('Triggers the creating hook')

    await expect
      .poll(() => pushedKinds.length, { timeout: 2000 })
      .toBeGreaterThan(0)
    expect(pushedKinds).toContain('dialogue')
  })

  it('schedules a push from the "updating" hook when a write lands on an already-queued row', async () => {
    let shouldFail = true
    let putCalls = 0
    stop = startSync({
      api: stubApi({
        putRecord: async (_kind, record) => {
          putCalls += 1
          if (shouldFail) throw new ApiError('store', 'temporarily down', 502)
          return record
        },
      }),
    })
    await expect.poll(() => getSyncInitialized()).toBe(true)

    const dialogue = await createDialogue('Will fail to push once')
    // The first debounced push (triggered by "creating") fails, so the row
    // stays queued.
    await expect.poll(() => putCalls, { timeout: 2000 }).toBeGreaterThan(0)
    expect(await takeOutbox()).toHaveLength(1)

    // A second local write to the *same* dialogue does a `put` on a key
    // that already exists in the outbox — Dexie fires "updating", not
    // "creating". Without listening to "updating" too, nothing would ever
    // schedule another push here.
    await renameDialogue(dialogue.id, 'Renamed while still queued')

    shouldFail = false
    await expect
      .poll(() => takeOutbox().then((rows) => rows.length), { timeout: 3000 })
      .toBe(0)
  })

  it('reschedules a push automatically when rows remain after one finishes (a write landed mid-push)', async () => {
    const dialogue = await createDialogue('Will be renamed mid-push')
    let putCalls = 0
    stop = startSync({
      api: stubApi({
        putRecord: async (_kind, record) => {
          putCalls += 1
          if (putCalls === 1) {
            // Lands while this very PUT is in flight, bumping the outbox
            // row's updatedAt so `clearOutbox` (src/db/repo.ts) declines to
            // delete it after this push cycle.
            await renameDialogue(dialogue.id, 'Renamed mid-flight')
          }
          return record
        },
      }),
    })

    // No further external trigger (no new create/update from here) — the
    // row must still drain via the reschedule-on-remaining behavior alone.
    await expect
      .poll(() => takeOutbox().then((rows) => rows.length), { timeout: 3000 })
      .toBe(0)
    expect(putCalls).toBeGreaterThanOrEqual(2)
  })
})

/** Minimal `window`/`document` stand-ins for a `node` test environment, just enough for `startSync`'s `online`/`visibilitychange` listeners to attach and fire. */
function stubBrowserGlobals(): { fireOnline: () => void } {
  class WindowStub extends EventTarget {}
  class DocumentStub extends EventTarget {
    visibilityState: 'visible' | 'hidden' = 'visible'
  }
  const windowStub = new WindowStub()
  const documentStub = new DocumentStub()
  vi.stubGlobal('window', windowStub)
  vi.stubGlobal('document', documentStub)
  return { fireOnline: () => windowStub.dispatchEvent(new Event('online')) }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// `vi.useFakeTimers()` was tried here first, but Dexie schedules its
// internal transaction ticks via `setImmediate`
// (node_modules/dexie/dist/dexie.js), and a chain of several dependent
// Dexie/IndexedDB steps (as `runPush` -> `push` -> load/PUT/merge/
// clearOutbox is) never reliably settled under it even with repeated
// `advanceTimersByTimeAsync` calls — it hung. `startSync` instead accepts
// `pushDebounceMs`/`retryBackoffMs` overrides (test-only; real callers
// never pass them) so these run against real timers, just scaled from
// seconds down to milliseconds — same doubling-then-capped shape, fast and
// deterministic.
/**
 * Runs a throwaway `startSync`/`stop` cycle so `meta.syncInitialized` is
 * already set before the real test body runs. Without this, `createDialogue`
 * (called before `startSync` in these tests, to control exactly when the
 * "creating" hook fires) enqueues an outbox row that the *next* `startSync`'s
 * own first-run sweep would then re-`put` — firing an extra, untested
 * "updating" event and scheduling a second concurrent push. Priming first
 * keeps each test's `putRecord` call count driven by exactly one path.
 */
async function primeSyncInitialized(): Promise<void> {
  const stopPrimer = startSync({ api: stubApi() })
  await expect.poll(() => getSyncInitialized()).toBe(true)
  stopPrimer()
}

describe('startSync offline vs. error retry backoff', () => {
  afterEach(() => {
    // Must stop the sync loop (unsubscribing its Dexie hooks/listeners)
    // *before* un-stubbing window/document — afterEach hooks run
    // innermost-first, so doing it here beats the top-level `stop?.()` to it.
    stop?.()
    stop = null
    vi.unstubAllGlobals()
  })

  it('offline: never schedules a retry timer — only "online" (or a new write) triggers the next attempt', async () => {
    await primeSyncInitialized()
    const { fireOnline } = stubBrowserGlobals()

    let putCalls = 0
    stop = startSync({
      pushDebounceMs: 5,
      api: stubApi({
        putRecord: async () => {
          putCalls += 1
          throw new ApiError('offline', 'no network', 0)
        },
      }),
    })
    // Let `startSync`'s own startup pull+push cycle (outbox still empty, so
    // a no-op) fully settle before writing — otherwise it can race
    // `createDialogue`'s own "creating"-triggered push and double-count.
    await sleep(50)
    await createDialogue('Offline write') // fires "creating" -> one debounced push

    await expect.poll(() => putCalls).toBe(1) // the debounced push attempt
    await sleep(300)
    expect(putCalls).toBe(1) // still 1 — 'offline' never schedules a backoff retry

    fireOnline()
    await expect.poll(() => putCalls).toBe(2) // the 'online' listener retried it
  })

  it('a non-offline failure retries with growing backoff, and success resets it', async () => {
    await primeSyncInitialized()

    let putCalls = 0
    stop = startSync({
      pushDebounceMs: 5,
      retryBackoffMs: [200, 400, 800, 1600],
      api: stubApi({
        putRecord: async (_kind, record) => {
          putCalls += 1
          if (putCalls < 3) {
            throw new ApiError('provider', 'model overloaded', 502)
          }
          return record
        },
      }),
    })
    // See the "offline" test above for why this settle-first wait matters.
    await sleep(50)
    await createDialogue('Fails twice then succeeds')

    await expect.poll(() => putCalls).toBe(1) // initial (debounced) attempt fails
    await sleep(100)
    expect(putCalls).toBe(1) // not yet — first backoff step is 200ms

    await expect.poll(() => putCalls, { timeout: 2000 }).toBe(2) // ~200ms: first retry, fails again
    await sleep(150)
    expect(putCalls).toBe(2) // not yet — second backoff step is 400ms

    await expect.poll(() => putCalls, { timeout: 2000 }).toBe(3) // second retry succeeds

    // Success resets the backoff and cancels the pending timer — no further
    // attempts.
    await sleep(1000)
    expect(putCalls).toBe(3)
  })
})
