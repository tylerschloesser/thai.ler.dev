import { useEffect, useState } from 'react'

const DEFAULT_INTERVAL_MS = 30_000

/**
 * The current time in ms, re-read on an interval so a component rendering
 * "N ago" text stays fresh without computing `Date.now()` during render
 * (an oxlint `react(purity)` violation, and a value that goes stale the
 * moment React skips a re-render for unrelated reasons).
 */
export function useNow(intervalMs: number = DEFAULT_INTERVAL_MS): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
