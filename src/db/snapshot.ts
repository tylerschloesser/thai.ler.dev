import { db, DB_SCHEMA_VERSION } from './db'
import type { AnnotationRecord, Base, Dialogue, SettingRow } from './db'
import { enqueueOutbox } from './repo'
import { getDeviceId } from './meta'
import { SETTINGS_RECORD_ID } from '../lib/records'
import { pickWinner, mergeSettingRows, settingsUpdatedAt } from '../lib/merge'
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

function assertSnapshotFormat(format: string): void {
  if (format !== SNAPSHOT_FORMAT) {
    throw new Error(
      `Cannot import snapshot: unrecognized format "${format}" ` +
        `(expected "${SNAPSHOT_FORMAT}").`,
    )
  }
}

/**
 * This is the internal seeding/debug format now (no user-facing
 * import/export), so every snapshot handed to `mergeSnapshot`/
 * `importSnapshot` is expected to already be at the current
 * `DB_SCHEMA_VERSION` shape — refuses anything else with a readable error
 * rather than silently coercing it.
 */
function assertCurrentSchemaVersion(schemaVersion: number): void {
  if (schemaVersion !== DB_SCHEMA_VERSION) {
    throw new Error(
      `Cannot import snapshot: schemaVersion ${schemaVersion} is not supported ` +
        `by this app (expected ${DB_SCHEMA_VERSION}).`,
    )
  }
}

interface MergeById<T> {
  merged: T[]
  added: number
  updated: number
  skipped: number
  /** Records that were newly added or where `incoming` won — i.e. what actually changed. */
  changed: T[]
}

function mergeById<T extends Base>(local: T[], incoming: T[]): MergeById<T> {
  const byId = new Map<string, T>(local.map((record) => [record.id, record]))
  let added = 0
  let updated = 0
  let skipped = 0
  const changed: T[] = []

  for (const incomingRecord of incoming) {
    const existing = byId.get(incomingRecord.id)
    if (!existing) {
      byId.set(incomingRecord.id, incomingRecord)
      added += 1
      changed.push(incomingRecord)
      continue
    }
    if (pickWinner(existing, incomingRecord) === 'incoming') {
      byId.set(incomingRecord.id, incomingRecord)
      updated += 1
      changed.push(incomingRecord)
    } else {
      skipped += 1
    }
  }

  return { merged: [...byId.values()], added, updated, skipped, changed }
}

interface MergeSettings {
  merged: SettingRow[]
  added: number
  updated: number
  skipped: number
  /** True if any key was added or changed, i.e. the `settings:all` record needs to be re-synced. */
  changed: boolean
}

/**
 * Wraps `mergeSettingRows` (`src/lib/merge.ts`) with the added/updated/
 * skipped counts and a changed flag that `mergeSnapshot`/`importSnapshot`
 * need — `mergeSettingRows` itself stays a pure "give me the merged rows"
 * function shared with the server.
 */
function mergeSettings(
  local: SettingRow[],
  incoming: SettingRow[],
): MergeSettings {
  const merged = mergeSettingRows(local, incoming)
  const localByKey = new Map(local.map((row) => [row.key, row]))
  let added = 0
  let updated = 0
  let skipped = 0

  for (const row of merged) {
    const existing = localByKey.get(row.key)
    if (!existing) {
      added += 1
    } else if (existing !== row) {
      updated += 1
    } else {
      skipped += 1
    }
  }

  return { merged, added, updated, skipped, changed: added + updated > 0 }
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
  assertCurrentSchemaVersion(incoming.schemaVersion)

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
 * Enqueues an outbox row (`repo.enqueueOutbox`) for every record actually
 * added or updated by the merge, so an imported library gets pushed to the
 * server on the next sync. Returns counts so the UI can toast them.
 */
export async function importSnapshot(incoming: Snapshot): Promise<MergeCounts> {
  assertSnapshotFormat(incoming.format)
  assertCurrentSchemaVersion(incoming.schemaVersion)
  const local: Snapshot = {
    format: SNAPSHOT_FORMAT,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    deviceId: await getDeviceId(),
    dialogues: await db.dialogues.toArray(),
    annotations: await db.annotations.toArray(),
    settings: await db.settings.toArray(),
  }

  const dialogues = mergeById(local.dialogues, incoming.dialogues)
  const annotations = mergeById(local.annotations, incoming.annotations)
  const settings = mergeSettings(local.settings, incoming.settings)

  await db.transaction(
    'rw',
    db.dialogues,
    db.annotations,
    db.settings,
    db.outbox,
    async () => {
      if (dialogues.merged.length > 0) {
        await db.dialogues.bulkPut(dialogues.merged)
      }
      if (annotations.merged.length > 0) {
        await db.annotations.bulkPut(annotations.merged)
      }
      if (settings.merged.length > 0) {
        await db.settings.bulkPut(settings.merged)
      }
      for (const dialogue of dialogues.changed) {
        await enqueueOutbox('dialogue', dialogue.id, dialogue.updatedAt)
      }
      for (const annotation of annotations.changed) {
        await enqueueOutbox('annotation', annotation.id, annotation.updatedAt)
      }
      if (settings.changed) {
        await enqueueOutbox(
          'settings',
          SETTINGS_RECORD_ID,
          settingsUpdatedAt(settings.merged, nowIso()),
        )
      }
    },
  )

  return {
    added: dialogues.added + annotations.added + settings.added,
    updated: dialogues.updated + annotations.updated + settings.updated,
    skipped: dialogues.skipped + annotations.skipped + settings.skipped,
  }
}
