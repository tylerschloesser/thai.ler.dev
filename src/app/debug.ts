// `installDebug()` is called once from `src/main.tsx`, before
// `RouterProvider` mounts, so `window.__thai` exists before the app (and
// any e2e test) relies on it.

import { db, purgeTombstones } from '../db/db'
import { exportSnapshot, importSnapshot } from '../db/snapshot'
import { pull } from '../sync/pull'
import { push } from '../sync/push'
import { pollNow } from '../sync/poll'
import { status } from '../sync/index'

export interface ThaiDebugSyncApi {
  pull: typeof pull
  push: typeof push
  pollNow: typeof pollNow
  status: typeof status
}

export interface ThaiDebugApi {
  db: typeof db
  importSnapshot: typeof importSnapshot
  exportSnapshot: typeof exportSnapshot
  sync: ThaiDebugSyncApi
}

declare global {
  interface Window {
    __thai: ThaiDebugApi
  }
}

/**
 * Exposes `window.__thai = { db, importSnapshot, exportSnapshot, sync }`.
 * Always on in every environment (not test-only) — `.claude/rules/testing.md`'s
 * `seed` fixture and e2e specs depend on `window.__thai.importSnapshot`
 * being present on every page load. `sync` (M2) gives e2e a way to force a
 * pull/push/poll tick instead of waiting on real timers.
 */
export function installDebug(): void {
  window.__thai = {
    db,
    importSnapshot,
    exportSnapshot,
    sync: { pull, push, pollNow, status },
  }

  // Startup maintenance, fire-and-forget: never block first paint on this.
  void purgeTombstones()
}
