import { useEffect } from 'react'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { clarifications, translations } from './collections.ts'

const POLL_MS = 3_000

/**
 * Polls only while the server owes us something.
 *
 * Model results arrive out of band — the worker writes them long after the
 * request that triggered them returned — so the client has to look. Gating on
 * "is any row pending" keeps an idle app completely silent instead of
 * refetching on a timer forever.
 */
export function usePendingPoll(): void {
  const { data: pendingTranslations } = useLiveQuery({
    query: (q) => q.from({ row: translations }).where(({ row }) => eq(row.status, 'pending')),
  })
  const { data: pendingClarifications } = useLiveQuery({
    query: (q) =>
      q.from({ row: clarifications }).where(({ row }) => eq(row.status, 'pending')),
  })

  const waiting = (pendingTranslations?.length ?? 0) + (pendingClarifications?.length ?? 0)

  useEffect(() => {
    if (waiting === 0) return

    // Both collections share one query key, so this refills both.
    const timer = setInterval(() => {
      void translations.utils.refetch()
    }, POLL_MS)

    return () => clearInterval(timer)
  }, [waiting])
}
