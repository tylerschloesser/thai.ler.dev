import { useState } from 'react'
import { pull } from '../../sync/pull'
import { api } from '../../sync/api'
import { useSync } from '../../sync/useSync'
import { Button, useToast } from '../../ui'
import styles from './SyncStatus.module.css'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Coarse "N units ago" relative time - enough for a settings status line. */
function formatRelativeTime(iso: string, nowMs: number): string {
  const deltaMs = Math.max(0, nowMs - Date.parse(iso))
  if (deltaMs < 10_000) return 'just now'
  if (deltaMs < MINUTE_MS) return `${Math.round(deltaMs / 1000)}s ago`
  if (deltaMs < HOUR_MS) return `${Math.round(deltaMs / MINUTE_MS)}m ago`
  if (deltaMs < DAY_MS) return `${Math.round(deltaMs / HOUR_MS)}h ago`
  return `${Math.round(deltaMs / DAY_MS)}d ago`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error.'
}

/**
 * Settings' "Sync" section (PLAN.MD §4.5, M3): last pull (relative time),
 * pending pushes, a manual "Sync now" (`useSync().syncNow`), and "Rebuild
 * sync index" (`POST /api/sync/manifest/rebuild`, then a fresh pull) -
 * maintenance for when the manifest and the actual record blobs drift.
 * There is no API-key field anywhere in Settings anymore - the Anthropic
 * key lives only in the server's environment.
 */
export function SyncStatus() {
  const { lastPullAt, pendingPushes, lastError, syncNow } = useSync()
  const { add: addToast } = useToast()
  const [isSyncing, setIsSyncing] = useState(false)
  const [isRebuilding, setIsRebuilding] = useState(false)

  async function handleSyncNow() {
    setIsSyncing(true)
    try {
      await syncNow()
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleRebuild() {
    setIsRebuilding(true)
    try {
      await api.rebuildManifest()
      await pull()
      addToast({ title: 'Sync index rebuilt', type: 'success' })
    } catch (err) {
      addToast({
        title: 'Could not rebuild the sync index',
        description: errorMessage(err),
        type: 'error',
      })
    } finally {
      setIsRebuilding(false)
    }
  }

  const nowMs = Date.now()

  return (
    <section className={styles.root} aria-label="Sync">
      <h2 className={styles.heading}>Sync</h2>
      <dl className={styles.status}>
        <dt>Last pull</dt>
        <dd>{lastPullAt ? formatRelativeTime(lastPullAt, nowMs) : 'Never'}</dd>
        <dt>Pending pushes</dt>
        <dd>{pendingPushes}</dd>
      </dl>
      {lastError && <p className={styles.error}>{lastError.message}</p>}
      <div className={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={isSyncing}
          onClick={() => void handleSyncNow()}
        >
          {isSyncing ? 'Syncing…' : 'Sync now'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          disabled={isRebuilding}
          onClick={() => void handleRebuild()}
        >
          {isRebuilding ? 'Rebuilding…' : 'Rebuild sync index'}
        </Button>
      </div>
    </section>
  )
}
