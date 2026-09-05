import { useEffect, useState } from 'react'
import { offline } from './sync.ts'

export type SyncStatus = {
  online: boolean
  /** False in a non-leader tab: writes there go straight out, with no outbox. */
  durable: boolean
  pending: number
}

const POLL_MS = 1_000

/**
 * Sync health, as its own concern rather than something bolted onto a
 * component's loading state. Drives the persistent indicator in the header.
 *
 * The outbox has no change subscription, so this samples it. That is cheap (an
 * IndexedDB read of a small list) and the indicator does not need to be exact
 * to the millisecond.
 */
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(() => ({
    online: navigator.onLine,
    durable: offline.isOfflineEnabled,
    pending: 0,
  }))

  useEffect(() => {
    let active = true

    const sample = async () => {
      const outbox = await offline.peekOutbox().catch(() => [])
      if (!active) return
      setStatus({
        online: offline.isOnline(),
        durable: offline.isOfflineEnabled,
        pending: outbox.length,
      })
    }

    void sample()
    const timer = setInterval(() => void sample(), POLL_MS)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  return status
}
