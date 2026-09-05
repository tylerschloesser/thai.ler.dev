import type { CollectionName } from '@thai/schema'

/**
 * Every row is partitioned by user, so turning auth on later needs no data
 * migration — only a real `userId` instead of the dev constant.
 */
export function pk(userId: string): string {
  return `USER#${userId}`
}

export function sk(collection: CollectionName, id: string): string {
  return `${collection}#${id}`
}

export function idempotencySk(key: string): string {
  return `IDEMP#${key}`
}

/**
 * Sort key of the `by-updated` LSI. Zero-padded so lexicographic order matches
 * numeric order, and suffixed so two rows written in the same millisecond stay
 * distinct — and so a query for `sk2 > <padded since>` still includes rows whose
 * `updatedAt` equals `since` exactly.
 */
export function updatedSk(updatedAt: number, collection: CollectionName, id: string): string {
  return `${padTimestamp(updatedAt)}#${collection}#${id}`
}

export function padTimestamp(ms: number): string {
  return String(Math.max(0, Math.floor(ms))).padStart(16, '0')
}

/**
 * Rows the worker writes commit concurrently with rows the API writes, so a
 * reader that trusted its own clock exactly could skip a row committed just
 * after its query but stamped just before `now`. Rewinding the watermark makes
 * the next poll re-read a couple of seconds of history instead; merges are
 * idempotent, so the only cost is a few redundant rows.
 */
export const SYNC_WATERMARK_SKEW_MS = 2_000

export function syncWatermark(): number {
  return Date.now() - SYNC_WATERMARK_SKEW_MS
}
