import { Link, useNavigate } from '@tanstack/react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useId, useRef, useState } from 'react'
import type { AnnotationRecord, Dialogue } from '../../db/db'
import {
  getAnnotation,
  getDialogue,
  renameDialogue,
  softDeleteDialogue,
} from '../../db/repo'
import { getSetting, setSetting } from '../../db/settings'
import type { Settings } from '../../db/settings'
import { exportSnapshot } from '../../db/snapshot'
import { splitDialogue } from '../../llm/split'
import { watchAnnotation } from '../../sync/poll'
import {
  AlertDialog,
  Button,
  Dialog,
  Field,
  Textarea,
  Toggle,
  useToast,
} from '../../ui'
import { AnnotateStatus } from '../annotate/AnnotateStatus'
import { startAnnotation } from '../annotate/useAnnotate'
import type { LineStatus } from '../annotate/useAnnotate'
import { LineView } from './LineView'
import styles from './DialogueView.module.css'

type DialogueLookup =
  | { found: false }
  | {
      found: true
      dialogue: Dialogue
      annotation: AnnotationRecord | undefined
    }

/**
 * One combined live query for both the dialogue and its current
 * annotation, rather than two separate `useLiveQuery` subscriptions - this
 * page already sits alongside `AnnotateStatus`'s own `useAnnotate` (which
 * subscribes to the same two records independently), so keeping this
 * page's own read footprint to a single subscription avoids piling on
 * more concurrent Dexie live queries than necessary.
 */
function useDialogueView(id: string): DialogueLookup | undefined {
  return useLiveQuery(async () => {
    const dialogue = await getDialogue(id)
    if (!dialogue) return { found: false }
    const annotation = dialogue.currentAnnotationId
      ? await getAnnotation(dialogue.currentAnnotationId)
      : undefined
    return { found: true, dialogue, annotation }
  }, [id])
}

type DisplaySettings = Pick<
  Settings,
  'showRomanization' | 'showGloss' | 'toneColors'
>

/** Combines the three display-toggle settings into one live query, same
 * rationale as `useDialogueView` above. */
function useDisplaySettings(): DisplaySettings | undefined {
  return useLiveQuery(
    async () => ({
      showRomanization: await getSetting('showRomanization'),
      showGloss: await getSetting('showGloss'),
      toneColors: await getSetting('toneColors'),
    }),
    [],
  )
}

/** Mirrors `useAnnotate`'s per-line status derivation (docs/plans/P0.md §5 M4), kept
 * local rather than mounting a second `useAnnotate(dialogueId)` instance
 * here just to read it - `AnnotateStatus` below already owns the one
 * instance that drives progress/cancel/retry for this page. */
function lineStatus(line: unknown, error: string | null): LineStatus {
  if (line !== null) return 'done'
  return error !== null ? 'error' : 'pending'
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'dialogue'
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export interface DialogueViewProps {
  dialogueId: string
}

/**
 * The rendered annotation page (`/d/$id`, docs/plans/P0.md §4.3): title with inline
 * rename, a meta line (model, date, re-annotate, delete, export), the
 * display toggles, `AnnotateStatus` for in-flight progress, then a
 * `LineView` per line.
 */
export function DialogueView({ dialogueId }: DialogueViewProps) {
  const lookup = useDialogueView(dialogueId)
  const annotation = lookup?.found ? lookup.annotation : undefined
  const displaySettings = useDisplaySettings()
  const navigate = useNavigate()
  const { add: addToast } = useToast()

  const renameFieldId = useId()
  const [renameOpen, setRenameOpen] = useState(false)
  const [title, setTitle] = useState('')

  // Toasts each newly-failed line exactly once, keyed by the exact error
  // text so a line that fails again with a different message re-toasts
  // (docs/plans/P0.md §4.6 `errors` spec) but a re-render never duplicates one.
  // Resume-on-open (PLAN.MD §4.2/§4.5): while the current annotation's run
  // is `queued`/`running`, watch it — `src/sync/poll.ts`'s `watchAnnotation`
  // polls `GET /api/annotation` and, if the lease looks stalled, calls
  // `POST /api/annotation/resume` itself. This is the entire mechanism for
  // "come back later, on any browser, and a stuck job finishes" - nothing
  // else needs to happen on mount.
  const annotationId = annotation?.id
  const runState = annotation?.run.state
  useEffect(() => {
    if (!annotationId) return
    if (runState !== 'queued' && runState !== 'running') return
    return watchAnnotation(annotationId)
  }, [annotationId, runState])

  const toastedErrorsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!annotation) return
    annotation.lineErrors.forEach((lineError, index) => {
      if (!lineError) return
      const key = `${annotation.id}:${index}:${lineError}`
      if (toastedErrorsRef.current.has(key)) return
      toastedErrorsRef.current.add(key)
      addToast({
        title: `Line ${index + 1} failed to annotate`,
        description: lineError,
        type: 'error',
      })
    })
  }, [annotation, addToast])

  if (lookup === undefined) return null

  if (!lookup.found) {
    return (
      <div className={styles.notFound}>
        <h1>Dialogue {dialogueId} not found</h1>
        <p>It may have been deleted, or the link is incorrect.</p>
        <Button variant="secondary" render={<Link to="/" />}>
          Back to library
        </Button>
      </div>
    )
  }

  const { dialogue } = lookup
  const showRomanization = displaySettings?.showRomanization ?? true
  const showGloss = displaySettings?.showGloss ?? true
  const toneColors = displaySettings?.toneColors ?? true
  const splitLines = splitDialogue(dialogue.sourceText)

  function saveRename() {
    const trimmed = title.trim()
    if (trimmed.length > 0) void renameDialogue(dialogue.id, trimmed)
  }

  async function handleDelete() {
    await softDeleteDialogue(dialogue.id)
    await navigate({ to: '/' })
  }

  // A fresh annotation run, not routed through `useAnnotate` - this page
  // only needs `AnnotateStatus`'s single hook instance for progress/cancel/
  // retry (mounting a second one here just to expose `start` would double
  // up its resume-on-open effect). `startAnnotation` already guards against
  // starting a run that's in flight (see src/features/annotate/useAnnotate.ts),
  // so a duplicate click is a no-op toast rather than a duplicate run.
  async function handleReannotate() {
    try {
      await startAnnotation({
        id: dialogue.id,
        sourceText: dialogue.sourceText,
      })
    } catch (err) {
      addToast({
        title: 'Could not start annotation',
        description: err instanceof Error ? err.message : 'Unknown error',
        type: 'error',
      })
    }
  }

  async function handleExport() {
    const snapshot = await exportSnapshot()
    const filtered = {
      ...snapshot,
      dialogues: snapshot.dialogues.filter((row) => row.id === dialogue.id),
      annotations: snapshot.annotations.filter(
        (row) => row.dialogueId === dialogue.id,
      ),
      settings: [],
    }
    downloadJson(`${slugify(dialogue.title)}.json`, filtered)
  }

  return (
    <div className={styles.root}>
      <div className={styles.titleRow}>
        <h1 className={styles.title} lang="th">
          {dialogue.title}
        </h1>
        <Dialog.Root
          open={renameOpen}
          onOpenChange={(open) => {
            setRenameOpen(open)
            if (open) setTitle(dialogue.title)
          }}
        >
          <Dialog.Trigger render={<Button variant="ghost" size="sm" />}>
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
                onClick={saveRename}
              >
                Save
              </Dialog.Close>
            </div>
            <Dialog.IconClose />
          </Dialog.Popup>
        </Dialog.Root>
      </div>

      <div className={styles.meta}>
        <span>{annotation?.model ?? 'Not yet annotated'}</span>
        {annotation && (
          <span>{new Date(annotation.createdAt).toLocaleString()}</span>
        )}
        <div className={styles.metaActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleReannotate()}
          >
            Re-annotate
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleExport()}
          >
            Export
          </Button>
          <AlertDialog.Root>
            <AlertDialog.Trigger render={<Button variant="danger" size="sm" />}>
              Delete
            </AlertDialog.Trigger>
            <AlertDialog.Popup>
              <AlertDialog.Title>Delete this dialogue?</AlertDialog.Title>
              <AlertDialog.Description>
                "{dialogue.title}" will be removed from your library. This
                cannot be undone.
              </AlertDialog.Description>
              <AlertDialog.Actions>
                <AlertDialog.Close render={<Button variant="ghost" />}>
                  Cancel
                </AlertDialog.Close>
                <AlertDialog.Close
                  render={<Button variant="danger" />}
                  onClick={() => void handleDelete()}
                >
                  Delete
                </AlertDialog.Close>
              </AlertDialog.Actions>
            </AlertDialog.Popup>
          </AlertDialog.Root>
        </div>
      </div>

      <div className={styles.toggles} role="group" aria-label="Display options">
        <Toggle
          pressed={showRomanization}
          onPressedChange={(pressed) =>
            void setSetting('showRomanization', pressed)
          }
        >
          Romanization
        </Toggle>
        <Toggle
          pressed={showGloss}
          onPressedChange={(pressed) => void setSetting('showGloss', pressed)}
        >
          Gloss
        </Toggle>
        <Toggle
          pressed={toneColors}
          onPressedChange={(pressed) => void setSetting('toneColors', pressed)}
        >
          Tone colors
        </Toggle>
      </div>

      <AnnotateStatus dialogueId={dialogueId} />

      <ol className={styles.lines} aria-label="Dialogue lines">
        {splitLines.map((splitLine, index) => (
          <LineView
            key={index}
            splitLine={splitLine}
            line={annotation?.lines[index] ?? null}
            status={lineStatus(
              annotation?.lines[index] ?? null,
              annotation?.lineErrors[index] ?? null,
            )}
            error={annotation?.lineErrors[index] ?? null}
            showRomanization={showRomanization}
            showGloss={showGloss}
            toneColors={toneColors}
          />
        ))}
      </ol>
    </div>
  )
}
