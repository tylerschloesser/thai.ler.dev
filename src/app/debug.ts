// NOTE(M4): `installDebug()` must be called once at startup — e.g. near the
// top of `src/main.tsx`, before `RouterProvider` mounts — so
// `window.__thai` exists before the app (and any e2e test) can rely on it.
// Wiring it into `main.tsx` is out of scope for M2 (that file belongs to a
// different milestone/agent); this file just exports the function.

import { db, purgeTombstones } from '../db/db'
import { exportSnapshot, importSnapshot } from '../db/snapshot'

export interface ThaiDebugApi {
  db: typeof db
  importSnapshot: typeof importSnapshot
  exportSnapshot: typeof exportSnapshot
}

declare global {
  interface Window {
    __thai: ThaiDebugApi
  }
}

/**
 * Exposes `window.__thai = { db, importSnapshot, exportSnapshot }`. Always
 * on in every environment (not test-only) — `.claude/rules/testing.md`'s
 * `seed` fixture and e2e specs depend on `window.__thai.importSnapshot`
 * being present on every page load.
 */
export function installDebug(): void {
  window.__thai = { db, importSnapshot, exportSnapshot }

  // Startup maintenance, fire-and-forget: never block first paint on this.
  void purgeTombstones()
}
