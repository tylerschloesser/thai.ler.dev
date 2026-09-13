import type {
  AnnotationRecord,
  Dialogue,
  ManifestEntry,
  RecordKind,
  SettingRow,
} from '../lib/records'
import { settingsUpdatedAt } from '../lib/merge'
import { nowIso } from '../lib/time'
import { db } from '../db/db'
import {
  getAnnotation,
  getDialogue,
  mergeRemoteAnnotation,
  mergeRemoteDialogue,
  mergeRemoteSettings,
} from '../db/repo'
import { setLastPullAt } from '../db/meta'
import { api as defaultApi } from './api'
import type { SyncApi } from './api'

export interface PullCounts {
  pulled: number
  skipped: number
}

export interface PullDeps {
  api?: SyncApi
}

/** Just enough of a local record for `shouldPull` to mirror `pickWinner`. */
interface LocalMeta {
  updatedAt: string
  deletedAt: string | null
}

/**
 * `null` means "we have nothing locally yet", which always loses to the
 * manifest. Settings have no tombstone concept (`src/lib/merge.ts`'s
 * `mergeSettingRows`), so their `deletedAt` is always reported as `null` —
 * `shouldPull` below then falls back to a plain `>` comparison for them,
 * exactly like before this tie-break existed.
 */
async function localMeta(
  kind: RecordKind,
  id: string,
): Promise<LocalMeta | null> {
  if (kind === 'dialogue') {
    const row = await getDialogue(id)
    return row ? { updatedAt: row.updatedAt, deletedAt: row.deletedAt } : null
  }
  if (kind === 'annotation') {
    const row = await getAnnotation(id)
    return row ? { updatedAt: row.updatedAt, deletedAt: row.deletedAt } : null
  }
  const rows = await db.settings.toArray()
  if (rows.length === 0) return null
  return { updatedAt: settingsUpdatedAt(rows, ''), deletedAt: null }
}

/**
 * Mirrors `src/lib/merge.ts`'s `pickWinner` tie-break exactly, so the
 * manifest-diff shortcut never disagrees with what a `PUT` would have
 * decided: newer wins outright, and at an exact `updatedAt` tie a tombstone
 * (`deletedAt !== null`) beats a live record. Ties where neither or both
 * sides are tombstones keep local, same as `pickWinner`.
 */
function shouldPull(entry: ManifestEntry, local: LocalMeta | null): boolean {
  if (local === null) return true
  if (entry.updatedAt > local.updatedAt) return true
  if (entry.updatedAt === local.updatedAt) {
    return entry.deletedAt !== null && local.deletedAt === null
  }
  return false
}

async function mergeRemote(kind: RecordKind, record: unknown): Promise<void> {
  if (kind === 'dialogue') {
    await mergeRemoteDialogue(record as Dialogue)
  } else if (kind === 'annotation') {
    await mergeRemoteAnnotation(record as AnnotationRecord)
  } else {
    await mergeRemoteSettings(record as SettingRow[])
  }
}

/**
 * Manifest -> diff each entry against local via `shouldPull` (mirrors
 * `pickWinner`'s LWW-plus-tombstone-tie-break, not just `updatedAt`) ->
 * fetch every changed record -> merge it in (`repo.mergeRemote*`, LWW, no
 * outbox echo) -> stamp `meta.lastPullAt`. PLAN.MD §4.5 / §10 "Sync pull".
 */
export async function pull(deps: PullDeps = {}): Promise<PullCounts> {
  const api = deps.api ?? defaultApi
  const manifest = await api.getManifest()

  let pulled = 0
  let skipped = 0

  for (const entry of Object.values(manifest.entries)) {
    const local = await localMeta(entry.kind, entry.id)
    if (!shouldPull(entry, local)) {
      skipped += 1
      continue
    }
    const record = await api.getRecord(entry.kind, entry.id)
    await mergeRemote(entry.kind, record)
    pulled += 1
  }

  await setLastPullAt(nowIso())
  return { pulled, skipped }
}
