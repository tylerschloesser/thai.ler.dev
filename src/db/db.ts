import Dexie from 'dexie'
import type { EntityTable } from 'dexie'
import { newId } from '../lib/ids'
import { LEGACY_RUN } from '../lib/records'
import type {
  AnnotationRecord,
  AnnotationRun,
  AnnotationStatus,
  AnnotationUsage,
  Base,
  Dialogue,
  RecordKind,
  RunProvider,
  RunState,
  SettingRow,
} from '../lib/records'
import { RUN_PROVIDERS, RUN_STATES } from '../lib/records'
import type { LineAnnotation } from '../llm/schema'

// --- Shared record contract (PLAN.MD §4.4) ---------------------------------
//
// `Base`, `Dialogue`, `AnnotationRecord` (incl. `AnnotationRun`),
// `SettingRow` and friends now live in `src/lib/records.ts` — the shared
// contract between M1 (`api/**`) and M2 (`src/db/**`), which never imports
// Dexie. Re-exported here so every existing `from '../db/db'` /
// `from './db'` import keeps working unchanged.
export type {
  AnnotationRecord,
  AnnotationRun,
  AnnotationStatus,
  AnnotationUsage,
  Base,
  Dialogue,
  RecordKind,
  RunProvider,
  RunState,
  SettingRow,
}
export { LEGACY_RUN, RUN_PROVIDERS, RUN_STATES }

// `LineAnnotation` (and its nested `Sentence`/`Word`/`Syllable`/`Note`
// shapes) is `src/llm/schema.ts`'s zod-inferred type — the single canonical
// definition, no longer duplicated here as a hand-kept structural mirror.
export type { LineAnnotation }

export type MetaKey =
  'deviceId' | 'schemaVersion' | 'lastPullAt' | 'syncInitialized'

export interface MetaRow {
  key: MetaKey
  value: string
}

/**
 * One row per record queued for the next `push()` (`src/sync/push.ts`).
 * Keyed by `key` (`` `${kind}:${id}` ``, e.g. `dialogue:<id>` or
 * `settings:all` — see `manifestKey` in `src/lib/records.ts`, the same
 * format as a manifest entry key) so repeated writes to the same record
 * before it's drained coalesce into one row via `put`. `rev` is a fresh
 * `newId()` stamped on every enqueue — `updatedAt` is for ordering/display
 * only and is not unique enough to key `clearOutbox`'s compare-and-delete
 * on: two writes to the same record in the same millisecond (e.g. a create
 * immediately followed by a rename) would otherwise share an `updatedAt`,
 * and a push racing the second write could delete the second write's row
 * using the first write's stale `updatedAt`. `rev` is intentionally not
 * part of the `outbox` index (`key, updatedAt` — no schema/version bump
 * needed for it).
 */
export interface OutboxRow {
  key: string
  kind: RecordKind
  id: string
  updatedAt: string
  rev: string
}

/** Bump whenever the shape of `LineAnnotation` (and friends) changes. */
export const ANNOTATION_SCHEMA_VERSION = 1

/**
 * Dexie schema version. Bump this — and add a `.version(n).stores(...)`
 * block with a `.upgrade()` callback — whenever a table's shape or indexes
 * change. Never mutate an existing versioned `.stores()` block in place
 * (see `.claude/rules/data.md`). Keep `meta.schemaVersion` in step with it.
 */
export const DB_SCHEMA_VERSION = 2

const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

export class ThaiLerDb extends Dexie {
  dialogues!: EntityTable<Dialogue, 'id'>
  annotations!: EntityTable<AnnotationRecord, 'id'>
  settings!: EntityTable<SettingRow, 'key'>
  meta!: EntityTable<MetaRow, 'key'>
  outbox!: EntityTable<OutboxRow, 'key'>

  constructor() {
    super('thai.ler.dev')
    this.version(1).stores({
      dialogues: 'id, updatedAt, deletedAt',
      annotations: 'id, dialogueId, updatedAt',
      settings: 'key',
      meta: 'key',
    })
    // v2 (PLAN.MD §4.4/§10): every pre-M1 annotation gets a `run` (it was
    // always a synchronous, already-finished browser run — `LEGACY_RUN`),
    // and a new `outbox` table backs the client sync push queue.
    this.version(DB_SCHEMA_VERSION)
      .stores({
        dialogues: 'id, updatedAt, deletedAt',
        annotations: 'id, dialogueId, updatedAt',
        settings: 'key',
        meta: 'key',
        outbox: 'key, updatedAt',
      })
      .upgrade((tx) =>
        tx
          .table('annotations')
          .toCollection()
          .modify((row: { run?: AnnotationRun }) => {
            row.run ??= { ...LEGACY_RUN }
          }),
      )
    // Fires exactly once, the first time this database is created on a
    // device, so this is where a fresh `deviceId` is minted and stays
    // stable thereafter (sync-readiness: docs/plans/P0.md §4.5).
    this.on('populate', () => {
      void this.meta.bulkAdd([
        { key: 'deviceId', value: newId() },
        { key: 'schemaVersion', value: String(DB_SCHEMA_VERSION) },
      ])
    })
  }
}

export const db = new ThaiLerDb()

/**
 * Hard-deletes soft-deleted `dialogues`/`annotations` rows whose
 * `deletedAt` is older than 90 days. Pure w.r.t. wall-clock time via the
 * `now` parameter, so it's directly unit-testable with fake-indexeddb.
 * Callers (see `src/app/debug.ts`) should invoke this fire-and-forget on
 * startup — it must never be `await`-ed on the critical path to first
 * paint.
 */
export async function purgeTombstones(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - TOMBSTONE_TTL_MS).toISOString()

  // `deletedAt` is indexed on `dialogues`, and (per the comment on `Base`
  // in `src/lib/records.ts`) every entry in that index is already a
  // tombstone, so this is a plain efficient range scan.
  const staleDialogueIds = await db.dialogues
    .where('deletedAt')
    .below(cutoff)
    .primaryKeys()

  // `annotations` has no `deletedAt` index (docs/plans/P0.md §4.1 lists only `id,
  // dialogueId, updatedAt`), so this is a full-table filter instead. Fine
  // at this app's scale.
  const staleAnnotationIds = await db.annotations
    .filter((row) => row.deletedAt !== null && row.deletedAt < cutoff)
    .primaryKeys()

  await db.transaction('rw', db.dialogues, db.annotations, async () => {
    if (staleDialogueIds.length > 0) {
      await db.dialogues.bulkDelete(staleDialogueIds)
    }
    if (staleAnnotationIds.length > 0) {
      await db.annotations.bulkDelete(staleAnnotationIds)
    }
  })

  return staleDialogueIds.length + staleAnnotationIds.length
}
