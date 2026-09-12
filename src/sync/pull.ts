import type {
  AnnotationRecord,
  Dialogue,
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

/** `null` means "we have nothing locally yet", which always loses to the manifest. */
async function localUpdatedAt(
  kind: RecordKind,
  id: string,
): Promise<string | null> {
  if (kind === 'dialogue') {
    return (await getDialogue(id))?.updatedAt ?? null
  }
  if (kind === 'annotation') {
    return (await getAnnotation(id))?.updatedAt ?? null
  }
  const rows = await db.settings.toArray()
  return rows.length === 0 ? null : settingsUpdatedAt(rows, '')
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
 * Manifest -> diff by `updatedAt` against local -> fetch every changed
 * record -> merge it in (`repo.mergeRemote*`, LWW, no outbox echo) ->
 * stamp `meta.lastPullAt`. PLAN.MD §4.5 / §10 "Sync pull".
 */
export async function pull(deps: PullDeps = {}): Promise<PullCounts> {
  const api = deps.api ?? defaultApi
  const manifest = await api.getManifest()

  let pulled = 0
  let skipped = 0

  for (const entry of Object.values(manifest.entries)) {
    const local = await localUpdatedAt(entry.kind, entry.id)
    if (local !== null && local >= entry.updatedAt) {
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
