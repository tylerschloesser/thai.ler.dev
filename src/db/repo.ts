import { useLiveQuery } from 'dexie-react-hooks'
import { db, ANNOTATION_SCHEMA_VERSION } from './db'
import type { AnnotationRecord, Dialogue, LineAnnotation } from './db'
import { newId } from '../lib/ids'
import { nowIso } from '../lib/time'

// The only write path to `dialogues`/`annotations`. No component or hook
// writes to those tables directly (CLAUDE.md hard rule 1, .claude/rules/data.md).

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
  await db.dialogues.add(dialogue)
  return dialogue
}

export async function renameDialogue(id: string, title: string): Promise<void> {
  await db.dialogues.update(id, { title, updatedAt: nowIso() })
}

/** Soft delete only — never `db.dialogues.delete()` (see `purgeTombstones`). */
export async function softDeleteDialogue(id: string): Promise<void> {
  const now = nowIso()
  await db.dialogues.update(id, { deletedAt: now, updatedAt: now })
}

/** Plain async read, for tests and any non-React caller. */
export async function listDialoguesAsync(): Promise<Dialogue[]> {
  const rows = await db.dialogues.orderBy('updatedAt').reverse().toArray()
  // `deletedAt` isn't usable as an index query here — see the comment on
  // `Base` in db.ts — so live rows are filtered in JS.
  return rows.filter((row) => row.deletedAt === null)
}

/**
 * Live/reactive read for React components, built on `useLiveQuery`.
 * Named `useListDialogues` locally (and re-exported as `listDialogues`,
 * matching PLAN.MD §4.1's repo API) so oxlint's react-hooks(rules-of-hooks)
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
 * Creates a new (`status: 'partial'`) annotation record with `lineCount`
 * empty slots, ready for `upsertAnnotationLine` to fill in as the M3
 * pipeline's per-line calls land. Not itself listed in PLAN.MD §4.1's repo
 * API, but required to construct the record that API operates on.
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
  }
  await db.annotations.add(annotation)
  return annotation
}

export type LineResult = { line: LineAnnotation } | { error: string }

/** Sets (or clears) one line's result/error, index-aligned with `split(sourceText)`. */
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

/** Marks an annotation `'complete'`; the pipeline decides when to call this. */
export async function finalizeAnnotation(annotationId: string): Promise<void> {
  const changed = await db.annotations.update(annotationId, {
    status: 'complete',
    updatedAt: nowIso(),
  })
  if (changed === 0) {
    throw new Error(`finalizeAnnotation: no annotation "${annotationId}"`)
  }
}

export async function setCurrentAnnotation(
  dialogueId: string,
  annotationId: string | null,
): Promise<void> {
  const changed = await db.dialogues.update(dialogueId, {
    currentAnnotationId: annotationId,
    updatedAt: nowIso(),
  })
  if (changed === 0) {
    throw new Error(`setCurrentAnnotation: no dialogue "${dialogueId}"`)
  }
}
