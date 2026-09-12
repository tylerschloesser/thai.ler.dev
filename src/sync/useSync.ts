import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { getLastPullAt } from '../db/meta'
import { pull } from './pull'
import { push } from './push'

export interface UseSyncResult {
  /** `null` until the first successful pull; refreshed by `syncNow` and by `startSync`'s own pulls. */
  lastPullAt: string | null
  /** Live count of `db.outbox` rows — records not yet confirmed pushed. */
  pendingPushes: number
  lastError: Error | null
  /** Runs one pull, then one push, and refreshes `lastPullAt`/`lastError`. */
  syncNow: () => Promise<void>
}

function errorFrom(err: unknown): Error {
  return err instanceof Error ? err : new Error('Sync failed')
}

/** Status for the Settings "Sync" section: last pull, pending pushes, manual sync. */
export function useSync(): UseSyncResult {
  const pendingPushes = useLiveQuery(() => db.outbox.count(), []) ?? 0
  const [lastPullAt, setLastPullAtState] = useState<string | null>(null)
  const [lastError, setLastError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    void getLastPullAt().then((value) => {
      if (!cancelled) setLastPullAtState(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const syncNow = useCallback(async () => {
    try {
      await pull()
      await push()
      setLastError(null)
    } catch (err) {
      setLastError(errorFrom(err))
    } finally {
      setLastPullAtState(await getLastPullAt())
    }
  }, [])

  return { lastPullAt, pendingPushes, lastError, syncNow }
}
