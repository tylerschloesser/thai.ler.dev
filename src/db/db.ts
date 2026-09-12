import Dexie from 'dexie'
import type { EntityTable } from 'dexie'
import { newId } from '../lib/ids'

// --- Sync-readiness base shape (docs/plans/P0.md §4.1) --------------------------

export interface Base {
  id: string
  createdAt: string
  updatedAt: string
  // Soft-delete tombstone. `null` means "alive". IndexedDB cannot use `null`
  // as an index key, so Dexie's `deletedAt` index below silently omits every
  // live row and only ever contains tombstoned rows (their `deletedAt` is a
  // real ISO string). Two consequences, both intentional:
  //   1. "list only live rows" cannot be expressed as `where('deletedAt')
  //      .equals(null)` — it never finds anything. We filter `deletedAt ===
  //      null` in JS instead (see repo.ts `listDialoguesAsync`), which is
  //      fine at this app's scale (a personal library, not a shared table).
  //   2. The index is still exactly what tombstone purging wants: every
  //      entry in it *is* a tombstone, so `purgeTombstones` below can do an
  //      efficient `where('deletedAt').below(cutoff)` range scan.
  deletedAt: string | null
}

export interface Dialogue extends Base {
  title: string // derived from first line, user-editable
  sourceText: string // exactly what was pasted
  currentAnnotationId: string | null
}

// --- Annotation line shape ----------------------------------------------
// Placeholder mirror of M3's `LineAnnotationSchema` (src/llm/schema.ts,
// zod, docs/plans/P0.md §4.2). src/db must not depend on src/llm, so these are
// plain structural interfaces kept in sync by hand; M3 should either keep
// these in step with its zod schema or replace them with `z.infer<...>`
// re-exports once it lands.
export type ToneName = 'mid' | 'low' | 'falling' | 'high' | 'rising'

export type NoteKind =
  | 'common_phrase'
  | 'pronunciation'
  | 'spelling_mismatch'
  | 'particle'
  | 'register'
  | 'classifier'
  | 'loanword'
  | 'compound'
  | 'idiom'
  | 'colloquial'
  | 'no_equivalent'
  | 'grammar'
  | 'culture'
  | 'other'

export type PartOfSpeech =
  | 'noun'
  | 'verb'
  | 'adjective'
  | 'adverb'
  | 'pronoun'
  | 'particle'
  | 'classifier'
  | 'preposition'
  | 'conjunction'
  | 'question_word'
  | 'number'
  | 'name'
  | 'interjection'
  | 'other'

export interface Note {
  kind: NoteKind
  text: string
}

export interface Syllable {
  thai: string
  romanization: string
  tone: ToneName
  toneExplanation: string | null
  meaning: string | null
}

export interface Word {
  thai: string
  romanization: string
  gloss: string
  partOfSpeech: PartOfSpeech
  syllables: Syllable[]
  notes: Note[]
}

export interface Sentence {
  thai: string
  romanization: string
  translation: string
  literal: string | null
  words: Word[]
  notes: Note[]
}

export interface LineAnnotation {
  speaker: string | null
  thai: string
  translation: string
  sentences: Sentence[]
  notes: Note[]
}

export type AnnotationStatus = 'partial' | 'complete'

export interface AnnotationUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export interface AnnotationRecord extends Base {
  dialogueId: string
  model: string // e.g. 'claude-opus-5'
  promptVersion: number // PROMPT_VERSION at time of run
  schemaVersion: number // ANNOTATION_SCHEMA_VERSION at time of run
  lines: Array<LineAnnotation | null> // index-aligned with split(sourceText)
  lineErrors: Array<string | null>
  status: AnnotationStatus
  usage: AnnotationUsage
  durationMs: number
}

export interface SettingRow {
  key: string
  value: unknown
  updatedAt: string
}

export type MetaKey = 'deviceId' | 'schemaVersion'

export interface MetaRow {
  key: MetaKey
  value: string
}

/** Bump whenever the shape of `LineAnnotation` (and friends) changes. */
export const ANNOTATION_SCHEMA_VERSION = 1

/**
 * Dexie schema version. Bump this — and add a `.version(n).stores(...)`
 * block with a `.upgrade()` callback — whenever a table's shape or indexes
 * change. Never mutate an existing versioned `.stores()` block in place
 * (see `.claude/rules/data.md`). Keep `meta.schemaVersion` in step with it.
 */
export const DB_SCHEMA_VERSION = 1

const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

export class ThaiLerDb extends Dexie {
  dialogues!: EntityTable<Dialogue, 'id'>
  annotations!: EntityTable<AnnotationRecord, 'id'>
  settings!: EntityTable<SettingRow, 'key'>
  meta!: EntityTable<MetaRow, 'key'>

  constructor() {
    super('thai.ler.dev')
    this.version(DB_SCHEMA_VERSION).stores({
      dialogues: 'id, updatedAt, deletedAt',
      annotations: 'id, dialogueId, updatedAt',
      settings: 'key',
      meta: 'key',
    })
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

  // `deletedAt` is indexed on `dialogues`, and (per the comment on `Base`)
  // every entry in that index is already a tombstone, so this is a plain
  // efficient range scan.
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
