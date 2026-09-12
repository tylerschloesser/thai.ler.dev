import type { SettingRow } from './records.js'

// Shared last-writer-wins merge rule, used by `src/db/snapshot.ts` (client
// merge) and M1's `api/_lib/records.ts` / `PUT /api/sync/record` (server
// merge) so both sides agree on exactly one semantics. See PLAN.MD §4.1
// ("Server-side LWW against the stored copy (`pickWinner` semantics from
// `src/db/snapshot.ts`, extracted to `src/lib/merge.ts`)") and §4.4.

export interface Mergeable {
  updatedAt: string
  deletedAt: string | null
}

/**
 * Last-writer-wins by `updatedAt`, with tombstones winning ties: if both
 * sides were written at the same instant, whichever one is a soft-delete
 * tombstone (`deletedAt !== null`) wins, regardless of which side (local or
 * incoming) it came from. This also means a tombstone is never resurrected
 * by an older live copy — that's just plain LWW, since the tombstone's
 * `updatedAt` is strictly newer.
 */
export function pickWinner<T extends Mergeable>(
  local: T,
  incoming: T,
): 'local' | 'incoming' {
  if (incoming.updatedAt > local.updatedAt) return 'incoming'
  if (incoming.updatedAt < local.updatedAt) return 'local'
  const localIsTombstone = local.deletedAt !== null
  const incomingIsTombstone = incoming.deletedAt !== null
  if (incomingIsTombstone && !localIsTombstone) return 'incoming'
  return 'local'
}

/**
 * Settings have no tombstone concept — just plain LWW by `updatedAt` per
 * key, ties keep local. Identical semantics to `mergeSettings` in
 * `src/db/snapshot.ts` (pre-extraction), used by both the client's
 * `mergeRemoteSettings` and the server's `PUT /api/sync/record` for the
 * `kind: 'settings'` record (a `SettingRow[]` keyed by `SETTINGS_RECORD_ID`,
 * PLAN.MD §4.3/§4.4). Returns the merged rows sorted by `key` for
 * deterministic output (the input maps have no inherent order).
 */
export function mergeSettingRows(
  local: SettingRow[],
  incoming: SettingRow[],
): SettingRow[] {
  const byKey = new Map<string, SettingRow>(local.map((row) => [row.key, row]))

  for (const incomingRow of incoming) {
    const existing = byKey.get(incomingRow.key)
    if (!existing || incomingRow.updatedAt > existing.updatedAt) {
      byKey.set(incomingRow.key, incomingRow)
    }
  }

  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * The manifest entry `updatedAt` for the single `settings:<SETTINGS_RECORD_ID>`
 * record is the newest row's `updatedAt` (rows have no shared timestamp of
 * their own); `fallback` covers the empty-array case (e.g. no settings
 * written yet).
 */
export function settingsUpdatedAt(
  rows: SettingRow[],
  fallback: string,
): string {
  if (rows.length === 0) return fallback
  return rows.reduce(
    (max, row) => (row.updatedAt > max ? row.updatedAt : max),
    rows[0]!.updatedAt,
  )
}
