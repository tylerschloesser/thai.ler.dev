import { db, DB_SCHEMA_VERSION } from './db'
import type { AnnotationRecord, Base, Dialogue, SettingRow } from './db'
import { getDeviceId } from './meta'
import { nowIso } from '../lib/time'

export const SNAPSHOT_FORMAT = 'thai.ler.dev/snapshot' as const

export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT
  schemaVersion: number
  exportedAt: string
  deviceId: string
  dialogues: Dialogue[]
  annotations: AnnotationRecord[]
  settings: SettingRow[]
}

export interface MergeCounts {
  added: number
  updated: number
  skipped: number
}

export interface MergeOutcome {
  dialogues: Dialogue[]
  annotations: AnnotationRecord[]
  settings: SettingRow[]
  counts: MergeCounts
}

function assertSupportedSchemaVersion(schemaVersion: number): void {
  if (schemaVersion !== DB_SCHEMA_VERSION) {
    throw new Error(
      `Cannot import snapshot: schemaVersion ${schemaVersion} is not supported ` +
        `by this app (expected ${DB_SCHEMA_VERSION}). Update the app before ` +
        'importing this snapshot.',
    )
  }
}

function assertSnapshotFormat(format: string): void {
  if (format !== SNAPSHOT_FORMAT) {
    throw new Error(
      `Cannot import snapshot: unrecognized format "${format}" ` +
        `(expected "${SNAPSHOT_FORMAT}").`,
    )
  }
}

interface MergeById<T> {
  merged: T[]
  added: number
  updated: number
  skipped: number
}

/**
 * Last-writer-wins by `updatedAt`, with tombstones winning ties: if both
 * sides were written at the same instant, whichever one is a soft-delete
 * tombstone (`deletedAt !== null`) wins, regardless of which side (local or
 * incoming) it came from. This also means a tombstone is never resurrected
 * by an older live copy — that's just plain LWW, since the tombstone's
 * `updatedAt` is strictly newer.
 */
function pickWinner<T extends Base>(
  local: T,
  incoming: T,
): 'local' | 'incoming' {
  if (incoming.updatedAt > local.updatedAt) return 'incoming'
  if (incoming.updatedAt < local.updatedAt) return 'local'
  const localIsTombstone = local.deletedAt !== null
  const incomingIsTombstone = incoming.deletedAt !== null
  if (incomingIsTombstone && !localIsTombstone) return 'incoming'
  return 'local'
}

function mergeById<T extends Base>(local: T[], incoming: T[]): MergeById<T> {
  const byId = new Map<string, T>(local.map((record) => [record.id, record]))
  let added = 0
  let updated = 0
  let skipped = 0

  for (const incomingRecord of incoming) {
    const existing = byId.get(incomingRecord.id)
    if (!existing) {
      byId.set(incomingRecord.id, incomingRecord)
      added += 1
      continue
    }
    if (pickWinner(existing, incomingRecord) === 'incoming') {
      byId.set(incomingRecord.id, incomingRecord)
      updated += 1
    } else {
      skipped += 1
    }
  }

  return { merged: [...byId.values()], added, updated, skipped }
}

/** Settings have no tombstone concept — just plain LWW by `updatedAt`, ties keep local. */
function mergeSettings(
  local: SettingRow[],
  incoming: SettingRow[],
): MergeById<SettingRow> {
  const byKey = new Map<string, SettingRow>(local.map((row) => [row.key, row]))
  let added = 0
  let updated = 0
  let skipped = 0

  for (const incomingRow of incoming) {
    const existing = byKey.get(incomingRow.key)
    if (!existing) {
      byKey.set(incomingRow.key, incomingRow)
      added += 1
      continue
    }
    if (incomingRow.updatedAt > existing.updatedAt) {
      byKey.set(incomingRow.key, incomingRow)
      updated += 1
    } else {
      skipped += 1
    }
  }

  return { merged: [...byKey.values()], added, updated, skipped }
}

/**
 * Pure merge of two snapshots: per-record last-writer-wins by `updatedAt`
 * (tombstones win ties), never wiping anything that's only in `local`.
 * Throws on an unsupported `format`/`schemaVersion` rather than silently
 * coercing. Does no I/O — safe to unit test directly.
 */
export function mergeSnapshot(
  local: Snapshot,
  incoming: Snapshot,
): MergeOutcome {
  assertSnapshotFormat(incoming.format)
  assertSupportedSchemaVersion(incoming.schemaVersion)

  const dialogues = mergeById(local.dialogues, incoming.dialogues)
  const annotations = mergeById(local.annotations, incoming.annotations)
  const settings = mergeSettings(local.settings, incoming.settings)

  return {
    dialogues: dialogues.merged,
    annotations: annotations.merged,
    settings: settings.merged,
    counts: {
      added: dialogues.added + annotations.added + settings.added,
      updated: dialogues.updated + annotations.updated + settings.updated,
      skipped: dialogues.skipped + annotations.skipped + settings.skipped,
    },
  }
}

export async function exportSnapshot(): Promise<Snapshot> {
  const [dialogues, annotations, settings, deviceId] = await Promise.all([
    db.dialogues.toArray(),
    db.annotations.toArray(),
    db.settings.toArray(),
    getDeviceId(),
  ])
  return {
    format: SNAPSHOT_FORMAT,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    deviceId,
    dialogues,
    annotations,
    settings,
  }
}

/**
 * Merges `incoming` into local storage. Never wipes local data — every
 * write is `bulkPut`, so records that exist only locally are left alone.
 * Returns counts so the UI can toast them.
 */
export async function importSnapshot(incoming: Snapshot): Promise<MergeCounts> {
  const local: Snapshot = {
    format: SNAPSHOT_FORMAT,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    deviceId: await getDeviceId(),
    dialogues: await db.dialogues.toArray(),
    annotations: await db.annotations.toArray(),
    settings: await db.settings.toArray(),
  }

  const merged = mergeSnapshot(local, incoming)

  await db.transaction(
    'rw',
    db.dialogues,
    db.annotations,
    db.settings,
    async () => {
      if (merged.dialogues.length > 0) {
        await db.dialogues.bulkPut(merged.dialogues)
      }
      if (merged.annotations.length > 0) {
        await db.annotations.bulkPut(merged.annotations)
      }
      if (merged.settings.length > 0) {
        await db.settings.bulkPut(merged.settings)
      }
    },
  )

  return merged.counts
}
