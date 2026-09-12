import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { exportSnapshot, importSnapshot } from '../../db/snapshot'
import type { Snapshot } from '../../db/snapshot'
import { Button, useToast } from '../../ui'
import styles from './ExportImport.module.css'

function formatDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Cheap shape check before handing the parsed JSON to `importSnapshot`
 * (which does the real validation - format + schemaVersion). This just
 * turns "not even an object" into a readable error instead of a thrown
 * TypeError from property access below.
 */
function looksLikeSnapshot(value: unknown): value is Snapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    'format' in value &&
    'schemaVersion' in value &&
    'dialogues' in value &&
    'annotations' in value &&
    'settings' in value
  )
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error.'
}

/**
 * Export downloads the current Dexie state as a snapshot JSON file. Import
 * reads a file, validates its shape, and merges it in via
 * `importSnapshot` (src/db/snapshot.ts) - merge only, it never wipes local
 * data. Both surface outcomes through the root Toast provider rather than
 * an inline banner, per .claude/rules/ui.md.
 */
export function ExportImport() {
  const { add: addToast } = useToast()
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleExport() {
    setIsExporting(true)
    try {
      const snapshot = await exportSnapshot()
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `thai-ler-dev-${formatDateStamp(new Date())}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      addToast({
        title: 'Export failed',
        description: errorMessage(err),
        type: 'error',
      })
    } finally {
      setIsExporting(false)
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setIsImporting(true)
    try {
      const text = await file.text()

      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('That file is not valid JSON.')
      }

      if (!looksLikeSnapshot(parsed)) {
        throw new Error('That file does not look like a thai.ler.dev snapshot.')
      }

      const counts = await importSnapshot(parsed)
      addToast({
        title: 'Import complete',
        description: `${counts.added} added, ${counts.updated} updated, ${counts.skipped} unchanged.`,
        type: 'success',
      })
    } catch (err) {
      addToast({
        title: 'Import failed',
        description: errorMessage(err),
        type: 'error',
      })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <section className={styles.root} aria-label="Export and import">
      <div className={styles.row}>
        <div className={styles.copy}>
          <h2 className={styles.heading}>Export</h2>
          <p className={styles.description}>
            Download every dialogue, annotation, and setting as one JSON file.
          </p>
        </div>
        <Button
          variant="secondary"
          type="button"
          disabled={isExporting}
          onClick={() => void handleExport()}
        >
          {isExporting ? 'Exporting…' : 'Export'}
        </Button>
      </div>

      <div className={styles.row}>
        <div className={styles.copy}>
          <h2 className={styles.heading}>Import</h2>
          <p className={styles.description}>
            Merge a previously exported file into this browser's library.
            Existing data is never wiped - only newer records win.
          </p>
        </div>
        <Button
          variant="secondary"
          type="button"
          disabled={isImporting}
          onClick={() => fileInputRef.current?.click()}
        >
          {isImporting ? 'Importing…' : 'Import file…'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          aria-label="Import snapshot file"
          className={styles.hiddenInput}
          onChange={(event) => void handleFileChange(event)}
        />
      </div>
    </section>
  )
}
