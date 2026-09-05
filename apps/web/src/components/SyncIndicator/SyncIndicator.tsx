import { useSyncStatus } from '../../db/useSyncStatus.ts'
import styles from './SyncIndicator.module.css'

/**
 * Sync health as a first-class, always-visible surface rather than something
 * inferred from a spinner somewhere.
 *
 * The "not durable" state is real and worth showing: only the leader tab owns
 * the outbox, so a second tab genuinely cannot queue writes offline.
 */
export function SyncIndicator() {
  const { online, durable, pending } = useSyncStatus()

  const { tone, label, detail } = describe(online, durable, pending)

  return (
    <output className={styles.root} data-tone={tone} title={detail} aria-live="polite">
      <span className={styles.dot} aria-hidden="true" />
      {label}
    </output>
  )
}

type Description = {
  tone: 'idle' | 'pending' | 'offline'
  label: string
  detail: string
}

function describe(online: boolean, durable: boolean, pending: number): Description {
  if (!online) {
    return {
      tone: 'offline',
      label: pending > 0 ? `Offline · ${pending} queued` : 'Offline',
      detail: durable
        ? 'Your changes are saved on this device and will sync when you reconnect.'
        : 'Another tab owns the offline queue. Changes made here need a connection.',
    }
  }
  if (pending > 0) {
    return {
      tone: 'pending',
      label: `Syncing ${pending}`,
      detail: `${pending} change${pending === 1 ? '' : 's'} still being sent.`,
    }
  }
  if (!durable) {
    return {
      tone: 'pending',
      label: 'Online only',
      detail: 'Another tab owns the offline queue, so changes made here need a connection.',
    }
  }
  return { tone: 'idle', label: 'Synced', detail: 'Everything is saved to the server.' }
}
