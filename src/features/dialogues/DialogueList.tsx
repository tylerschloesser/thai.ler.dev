import { Link } from '@tanstack/react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { useId, useState } from 'react'
import type { AnnotationRecord, Dialogue } from '../../db/db'
import {
  getAnnotationsByIds,
  listDialogues,
  renameDialogue,
  softDeleteDialogue,
} from '../../db/repo'
import { splitDialogue } from '../../llm/split'
import {
  AlertDialog,
  Button,
  Dialog,
  EmptyState,
  Field,
  Textarea,
} from '../../ui'
import styles from './DialogueList.module.css'

type ChipStatus = 'complete' | 'partial' | 'failed'

function firstNonBlankLine(sourceText: string): string {
  return (
    sourceText
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  )
}

/**
 * The `AnnotationRecord.status` field only distinguishes 'partial' /
 * 'complete' (src/db/db.ts) - "failed" (every line errored, nothing to
 * show) is a UI-level refinement of 'partial' derived here, per PLAN.MD
 * §4.3's three-state chip.
 */
function chipStatus(annotation: {
  status: 'partial' | 'complete'
  lines: Array<unknown | null>
  lineErrors: Array<string | null>
}): ChipStatus {
  if (annotation.status === 'complete') return 'complete'
  const attempted = annotation.lines.length > 0
  const allFailed =
    attempted &&
    annotation.lines.every((line) => line === null) &&
    annotation.lineErrors.every((error) => error !== null)
  return allFailed ? 'failed' : 'partial'
}

function DialogueRow({
  dialogue,
  annotation,
}: {
  dialogue: Dialogue
  annotation: AnnotationRecord | undefined
}) {
  const status: ChipStatus = annotation ? chipStatus(annotation) : 'partial'

  const renameFieldId = useId()
  const [renameOpen, setRenameOpen] = useState(false)
  const [title, setTitle] = useState(dialogue.title)

  function handleRenameOpenChange(open: boolean) {
    setRenameOpen(open)
    if (open) setTitle(dialogue.title)
  }

  function handleRenameSave() {
    const trimmed = title.trim()
    if (trimmed.length > 0) void renameDialogue(dialogue.id, trimmed)
  }

  const lineCount = splitDialogue(dialogue.sourceText).length

  return (
    <li className={styles.row}>
      <div className={styles.main}>
        <Link
          to="/d/$id"
          params={{ id: dialogue.id }}
          className={styles.titleLink}
          lang="th"
        >
          {dialogue.title}
        </Link>
        <p className={styles.firstLine} lang="th">
          {firstNonBlankLine(dialogue.sourceText)}
        </p>
        <p className={styles.meta}>
          {lineCount} {lineCount === 1 ? 'line' : 'lines'} ·{' '}
          <span className={styles.chip} data-status={status}>
            {status}
          </span>
        </p>
      </div>

      <div className={styles.rowActions}>
        <Dialog.Root open={renameOpen} onOpenChange={handleRenameOpenChange}>
          <Dialog.Trigger render={<Button variant="secondary" size="sm" />}>
            Rename
          </Dialog.Trigger>
          <Dialog.Popup>
            <Dialog.Title>Rename dialogue</Dialog.Title>
            <Field.Root>
              <Field.Label htmlFor={renameFieldId}>Title</Field.Label>
              <Textarea
                id={renameFieldId}
                rows={1}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                lang="th"
              />
            </Field.Root>
            <div className={styles.dialogActions}>
              <Dialog.Close render={<Button variant="ghost" />}>
                Cancel
              </Dialog.Close>
              <Dialog.Close
                render={<Button variant="primary" />}
                onClick={handleRenameSave}
              >
                Save
              </Dialog.Close>
            </div>
            <Dialog.IconClose />
          </Dialog.Popup>
        </Dialog.Root>

        <AlertDialog.Root>
          <AlertDialog.Trigger render={<Button variant="danger" size="sm" />}>
            Delete
          </AlertDialog.Trigger>
          <AlertDialog.Popup>
            <AlertDialog.Title>Delete this dialogue?</AlertDialog.Title>
            <AlertDialog.Description>
              "{dialogue.title}" will be removed from your library. This cannot
              be undone.
            </AlertDialog.Description>
            <AlertDialog.Actions>
              <AlertDialog.Close render={<Button variant="ghost" />}>
                Cancel
              </AlertDialog.Close>
              <AlertDialog.Close
                render={<Button variant="danger" />}
                onClick={() => void softDeleteDialogue(dialogue.id)}
              >
                Delete
              </AlertDialog.Close>
            </AlertDialog.Actions>
          </AlertDialog.Popup>
        </AlertDialog.Root>
      </div>
    </li>
  )
}

/**
 * The dialogue library: sorted by `updatedAt` desc (via the reactive
 * `listDialogues` hook, re-exported from src/db/repo.ts), each row showing
 * title, first line, line count, a status chip, an open link, and
 * rename/delete actions. There is no dedicated Menu primitive in the M1 UI
 * kit (src/ui), so "the menu" from PLAN.MD §4.3 is two inline row action
 * buttons rather than a dropdown.
 *
 * The status chip needs each dialogue's `AnnotationRecord` (for `status`/
 * `lineErrors`), which - because IndexedDB always deserializes a full
 * record, never a subset of fields - means loading the same large `lines`
 * blob the separate `annotations` table exists to keep out of the common
 * list/title/sourceText read (`.claude/rules/data.md`). That cost is
 * unavoidable for the chip itself, but it's paid **once** here via a single
 * batched `getAnnotationsByIds`, not once per row: the previous version ran
 * one `useLiveQuery(getAnnotation)` - one Dexie read plus one live
 * subscription - per dialogue.
 */
export function DialogueList() {
  const dialogues = listDialogues()
  const annotationIds = (dialogues ?? [])
    .map((dialogue) => dialogue.currentAnnotationId)
    .filter((id): id is string => id !== null)
  const annotationIdsKey = annotationIds.join(',')
  const annotations = useLiveQuery(
    () => getAnnotationsByIds(annotationIds),
    [annotationIdsKey],
  )

  if (dialogues === undefined) return null

  if (dialogues.length === 0) {
    return (
      <EmptyState
        title="No dialogues yet"
        description="Paste a dialogue above and run it through Claude to get started."
      />
    )
  }

  const annotationById = new Map<string, AnnotationRecord>()
  annotationIds.forEach((id, index) => {
    const record = annotations?.[index]
    if (record) annotationById.set(id, record)
  })

  return (
    <ul className={styles.list} aria-label="Dialogue library">
      {dialogues.map((dialogue) => (
        <DialogueRow
          key={dialogue.id}
          dialogue={dialogue}
          annotation={
            dialogue.currentAnnotationId
              ? annotationById.get(dialogue.currentAnnotationId)
              : undefined
          }
        />
      ))}
    </ul>
  )
}
