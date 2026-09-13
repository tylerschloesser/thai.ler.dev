import { useLiveQuery } from 'dexie-react-hooks'
import { db, ANNOTATION_SCHEMA_VERSION, LEGACY_RUN } from './db'
import type {
  AnnotationRecord,
  Dialogue,
  LineAnnotation,
  OutboxRow,
  SettingRow,
} from './db'
import { manifestKey } from '../lib/records'
import type { RecordKind } from '../lib/records'
import { mergeSettingRows, pickWinner } from '../lib/merge'
import { newId } from '../lib/ids'
import { nowIso } from '../lib/time'

// The only write path to `dialogues`/`annotations`/`outbox`. No component or
// hook writes to those tables directly (CLAUDE.md hard rule 1, .claude/rules/data.md).

const MAX_TITLE_LENGTH = 80
// A leading "speaker:" (or full-width "：") prefix, e.g. "Somchai: ...".
const SPEAKER_PREFIX_RE = /^[^\s:：]{1,30}[:：]\s*/

function deriveTitle(sourceText: string): string {
  const firstNonBlank = sourceText
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!firstNonBlank) return 'Untitled'

  const withoutSpeaker = firstNonBlank.replace(SPEAKER_PREFIX_RE, '').trim()
  const title = withoutSpeaker.length > 0 ? withoutSpeaker : firstNonBlank

  if (title.length <= MAX_TITLE_LENGTH) return title
  return `${title.slice(0, MAX_TITLE_LENGTH).trimEnd()}…`
}

// ---------------------------------------------------------------------------
// Outbox (PLAN.MD §4.4/§4.5) — the client sync push queue
// ---------------------------------------------------------------------------

/**
 * Queues `kind:id` for the next `src/sync/push.ts` run. Call **inside** the
 * same Dexie transaction as the write it records (Dexie joins an already-
 * open transaction automatically as long as `db.outbox` is one of the
 * tables passed to `db.transaction(...)`), so a write and its outbox entry
 * are always atomic. Uses `put`, so repeated writes to the same record
 * before it's drained coalesce into one row with the latest `updatedAt` —
 * but a fresh `rev` (`newId()`) every time, since two writes can share the
 * same `updatedAt` (same-millisecond) and `clearOutbox` needs a value that
 * is unique per write, not just per instant, to compare-and-delete safely.
 * `mergeRemote*` below must never call this — an incoming remote write is
 * not a local change and must not echo back to the server.
 */
export async function enqueueOutbox(
  kind: RecordKind,
  id: string,
  updatedAt: string,
): Promise<void> {
  await db.outbox.put({
    key: manifestKey(kind, id),
    kind,
    id,
    updatedAt,
    rev: newId(),
  })
}

/** A snapshot of every row currently queued for push. */
export async function takeOutbox(): Promise<OutboxRow[]> {
  return db.outbox.toArray()
}

/**
 * Removes `key` from the outbox, but only if its `rev` is still what the
 * caller last saw — i.e. only if nothing wrote to that record again while
 * the push for this row was in flight. If a newer local write landed
 * mid-push, `enqueueOutbox` already overwrote the row with a fresh `rev`
 * (even if it shares the same `updatedAt` as the write being pushed), this
 * delete is a no-op, and the row stays queued for the next push.
 */
export async function clearOutbox(key: string, rev: string): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    const row = await db.outbox.get(key)
    if (row && row.rev === rev) {
      await db.outbox.delete(key)
    }
  })
}

// ---------------------------------------------------------------------------
// Dialogues
// ---------------------------------------------------------------------------

export async function createDialogue(sourceText: string): Promise<Dialogue> {
  const now = nowIso()
  const dialogue: Dialogue = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    title: deriveTitle(sourceText),
    sourceText,
    currentAnnotationId: null,
  }
  await db.transaction('rw', db.dialogues, db.outbox, async () => {
    await db.dialogues.add(dialogue)
    await enqueueOutbox('dialogue', dialogue.id, dialogue.updatedAt)
  })
  return dialogue
}

export async function renameDialogue(id: string, title: string): Promise<void> {
  const updatedAt = nowIso()
  await db.transaction('rw', db.dialogues, db.outbox, async () => {
    await db.dialogues.update(id, { title, updatedAt })
    await enqueueOutbox('dialogue', id, updatedAt)
  })
}

/** Soft delete only — never `db.dialogues.delete()` (see `purgeTombstones`). */
export async function softDeleteDialogue(id: string): Promise<void> {
  const now = nowIso()
  await db.transaction('rw', db.dialogues, db.outbox, async () => {
    await db.dialogues.update(id, { deletedAt: now, updatedAt: now })
    await enqueueOutbox('dialogue', id, now)
  })
}

/** Plain async read, for tests and any non-React caller. */
export async function listDialoguesAsync(): Promise<Dialogue[]> {
  const rows = await db.dialogues.orderBy('updatedAt').reverse().toArray()
  // `deletedAt` isn't usable as an index query here — see the comment on
  // `Base` in `src/lib/records.ts` — so live rows are filtered in JS.
  return rows.filter((row) => row.deletedAt === null)
}

/**
 * Live/reactive read for React components, built on `useLiveQuery`.
 * Named `useListDialogues` locally (and re-exported as `listDialogues`,
 * matching docs/plans/P0.md §4.1's repo API) so oxlint's react-hooks(rules-of-hooks)
 * check — which requires a "use"-prefixed name on any function calling a
 * hook — doesn't flag it.
 */
function useListDialogues(): Dialogue[] | undefined {
  return useLiveQuery(() => listDialoguesAsync(), [])
}
export { useListDialogues as listDialogues }

export async function getDialogue(id: string): Promise<Dialogue | undefined> {
  return db.dialogues.get(id)
}

export async function getAnnotation(
  id: string,
): Promise<AnnotationRecord | undefined> {
  return db.annotations.get(id)
}

/**
 * Batched lookup for rendering a library-list status chip per row: one
 * `bulkGet` instead of one `getAnnotation` (and one live-query subscription)
 * per dialogue. Order-aligned with `ids`; a missing/deleted annotation is
 * `undefined` at that index.
 */
export async function getAnnotationsByIds(
  ids: string[],
): Promise<Array<AnnotationRecord | undefined>> {
  if (ids.length === 0) return []
  return db.annotations.bulkGet(ids)
}

// ---------------------------------------------------------------------------
// Annotation lifecycle
//
// @deprecated — removed in M3. `createAnnotation`/`upsertAnnotationLine`/
// `finalizeAnnotation` back the browser-side pipeline (`src/llm/pipeline.ts`)
// only until M3 moves annotation to the server (`api/_lib/runner.ts`); no
// new caller should be added. They intentionally stay decoupled from the
// outbox except at `finalizeAnnotation` — a partial, still-running client
// job has nothing useful to sync yet.
// ---------------------------------------------------------------------------

/**
 * Creates a new (`status: 'partial'`) annotation record with `lineCount`
 * empty slots, ready for `upsertAnnotationLine` to fill in as the P0
 * pipeline's per-line calls land. `run` starts as the legacy shape
 * (PLAN.MD §4.4) with `state: 'running'`, since this record represents a
 * job actively running in this tab right now, not an already-finished one.
 *
 * @deprecated removed in M3
 */
export async function createAnnotation(params: {
  dialogueId: string
  model: string
  promptVersion: number
  lineCount: number
}): Promise<AnnotationRecord> {
  const now = nowIso()
  const annotation: AnnotationRecord = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dialogueId: params.dialogueId,
    model: params.model,
    promptVersion: params.promptVersion,
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    lines: new Array<LineAnnotation | null>(params.lineCount).fill(null),
    lineErrors: new Array<string | null>(params.lineCount).fill(null),
    status: 'partial',
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    durationMs: 0,
    run: { ...LEGACY_RUN, state: 'running' },
  }
  await db.annotations.add(annotation)
  return annotation
}

export type LineResult = { line: LineAnnotation } | { error: string }

/**
 * Sets (or clears) one line's result/error, index-aligned with
 * `split(sourceText)`.
 *
 * @deprecated removed in M3
 */
export async function upsertAnnotationLine(
  annotationId: string,
  lineIndex: number,
  result: LineResult,
): Promise<void> {
  await db.transaction('rw', db.annotations, async () => {
    const existing = await db.annotations.get(annotationId)
    if (!existing) {
      throw new Error(`upsertAnnotationLine: no annotation "${annotationId}"`)
    }
    const lines = [...existing.lines]
    const lineErrors = [...existing.lineErrors]
    if ('error' in result) {
      lineErrors[lineIndex] = result.error
    } else {
      lines[lineIndex] = result.line
      lineErrors[lineIndex] = null
    }
    await db.annotations.update(annotationId, {
      lines,
      lineErrors,
      updatedAt: nowIso(),
    })
  })
}

/**
 * Marks an annotation `'complete'` and its `run` `'done'`; the pipeline
 * decides when to call this. Enqueues the finished record for push — the
 * one point in the legacy pipeline where there's a finished record worth
 * syncing.
 *
 * @deprecated removed in M3
 */
export async function finalizeAnnotation(annotationId: string): Promise<void> {
  const updatedAt = nowIso()
  await db.transaction('rw', db.annotations, db.outbox, async () => {
    const existing = await db.annotations.get(annotationId)
    if (!existing) {
      throw new Error(`finalizeAnnotation: no annotation "${annotationId}"`)
    }
    await db.annotations.update(annotationId, {
      status: 'complete',
      updatedAt,
      run: { ...existing.run, state: 'done' },
    })
    await enqueueOutbox('annotation', annotationId, updatedAt)
  })
}

export async function setCurrentAnnotation(
  dialogueId: string,
  annotationId: string | null,
): Promise<void> {
  const updatedAt = nowIso()
  await db.transaction('rw', db.dialogues, db.outbox, async () => {
    const changed = await db.dialogues.update(dialogueId, {
      currentAnnotationId: annotationId,
      updatedAt,
    })
    if (changed === 0) {
      throw new Error(`setCurrentAnnotation: no dialogue "${dialogueId}"`)
    }
    await enqueueOutbox('dialogue', dialogueId, updatedAt)
  })
}

// ---------------------------------------------------------------------------
// Remote merges (PLAN.MD §4.5) — used only by `src/sync/pull.ts` /
// `src/sync/push.ts`. Last-writer-wins via `src/lib/merge.ts`'s `pickWinner`
// / `mergeSettingRows`, the same rule the server applies. Never enqueue an
// outbox row here: an incoming remote record is not a local change, and
// echoing it back would loop forever.
// ---------------------------------------------------------------------------

/** Merges an incoming remote `Dialogue`; returns the local winner. */
export async function mergeRemoteDialogue(remote: Dialogue): Promise<Dialogue> {
  return db.transaction('rw', db.dialogues, async () => {
    const local = await db.dialogues.get(remote.id)
    if (!local || pickWinner(local, remote) === 'incoming') {
      await db.dialogues.put(remote)
      return remote
    }
    return local
  })
}

/** Merges an incoming remote `AnnotationRecord`; returns the local winner. */
export async function mergeRemoteAnnotation(
  remote: AnnotationRecord,
): Promise<AnnotationRecord> {
  return db.transaction('rw', db.annotations, async () => {
    const local = await db.annotations.get(remote.id)
    if (!local || pickWinner(local, remote) === 'incoming') {
      await db.annotations.put(remote)
      return remote
    }
    return local
  })
}

/**
 * Merges incoming remote settings rows against every local row (per-key
 * LWW, `mergeSettingRows`); returns the merged set (which is also what gets
 * written locally).
 */
export async function mergeRemoteSettings(
  remote: SettingRow[],
): Promise<SettingRow[]> {
  return db.transaction('rw', db.settings, async () => {
    const local = await db.settings.toArray()
    const merged = mergeSettingRows(local, remote)
    if (merged.length > 0) {
      await db.settings.bulkPut(merged)
    }
    return merged
  })
}
