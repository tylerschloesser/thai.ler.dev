import type {
  AnnotationRecord,
  Dialogue,
  RecordKind,
  SettingRow,
} from '../lib/records'
import { db } from '../db/db'
import {
  clearOutbox,
  getAnnotation,
  getDialogue,
  mergeRemoteAnnotation,
  mergeRemoteDialogue,
  mergeRemoteSettings,
  takeOutbox,
} from '../db/repo'
import { api as defaultApi, ApiError } from './api'
import type { SyncApi } from './api'

export interface PushCounts {
  pushed: number
  /** Outbox rows still queued when `push` returned (a failure, or an early stop on `offline`). */
  remaining: number
  /**
   * `'offline'` if the drain stopped early on a network failure, `'error'`
   * if at least one row failed for any other reason (drained the rest
   * anyway), or `null` if every attempted `PUT` succeeded. `src/sync/index.ts`'s
   * `runPush` uses this to decide whether — and how — to reschedule, so a
   * dead API/network never turns into a `PUT` every 500ms forever.
   */
  failed: 'offline' | 'error' | null
}

export interface PushDeps {
  api?: SyncApi
}

/** `null` only for a dialogue/annotation that vanished locally between enqueue and drain. */
async function loadLocal(
  kind: RecordKind,
  id: string,
): Promise<Dialogue | AnnotationRecord | SettingRow[] | null> {
  if (kind === 'dialogue') return (await getDialogue(id)) ?? null
  if (kind === 'annotation') return (await getAnnotation(id)) ?? null
  return db.settings.toArray()
}

async function mergeRemoteWinner(
  kind: RecordKind,
  winner: unknown,
): Promise<void> {
  if (kind === 'dialogue') {
    await mergeRemoteDialogue(winner as Dialogue)
  } else if (kind === 'annotation') {
    await mergeRemoteAnnotation(winner as AnnotationRecord)
  } else {
    await mergeRemoteSettings(winner as SettingRow[])
  }
}

/**
 * Drains the outbox: for each queued row, load the current local record,
 * `PUT` it, merge the server's LWW winner back in (never re-enqueues — see
 * `repo.mergeRemote*`), then `clearOutbox` (a no-op if the row changed
 * again mid-push, per its compare-and-delete semantics). A failed `PUT`
 * (anything but `offline`) leaves that one row queued and keeps draining
 * the rest; an `offline` failure stops draining immediately, since every
 * subsequent request would fail the same way. PLAN.MD §4.5.
 */
export async function push(deps: PushDeps = {}): Promise<PushCounts> {
  const api = deps.api ?? defaultApi
  const rows = await takeOutbox()
  let pushed = 0
  let hadError = false

  for (const row of rows) {
    const local = await loadLocal(row.kind, row.id)
    if (local === null) {
      // The record it referred to is gone locally (shouldn't normally
      // happen since deletes are soft) — nothing to push.
      await clearOutbox(row.key, row.updatedAt)
      continue
    }

    try {
      const winner = await api.putRecord(row.kind, local)
      await mergeRemoteWinner(row.kind, winner)
      await clearOutbox(row.key, row.updatedAt)
      pushed += 1
    } catch (err) {
      if (err instanceof ApiError && err.kind === 'offline') {
        const remaining = (await takeOutbox()).length
        return { pushed, remaining, failed: 'offline' }
      }
      // Any other failure: leave this row queued, keep draining the rest.
      hadError = true
    }
  }

  const remaining = (await takeOutbox()).length
  return { pushed, remaining, failed: hadError ? 'error' : null }
}
