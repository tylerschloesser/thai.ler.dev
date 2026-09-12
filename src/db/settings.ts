import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { SETTINGS_RECORD_ID } from '../lib/records'
import { enqueueOutbox } from './repo'
import { nowIso } from '../lib/time'

// This module owns the `settings` table the same way `repo.ts` owns
// `dialogues`/`annotations`: components and hooks call `getSetting` /
// `setSetting` / `useSetting`, never `db.settings.put` directly. It's kept
// separate from `repo.ts` (rather than folded into its write-path API)
// because settings are single-key rows with defaults, not soft-deletable
// records — see docs/plans/P0.md §4.1 and the file layout in CLAUDE.md.
//
// `setSetting` enqueues the single `settings:all` outbox entry
// (`repo.enqueueOutbox`) in the same transaction as the write: the whole
// `SettingRow[]` array is one logical sync record (PLAN.MD §4.3/§4.4), and
// this row's `updatedAt` — just stamped to now — is always the newest
// across all settings rows, matching the manifest's "newest row wins" rule
// (`settingsUpdatedAt` in `src/lib/merge.ts`).

export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  model: string
  apiKeyOverride: string | null
  showRomanization: boolean
  showGloss: boolean
  toneColors: boolean
  theme: Theme
  thaiFontScale: number
}

export const SETTINGS_DEFAULTS: Settings = {
  model: 'claude-opus-5',
  apiKeyOverride: null,
  showRomanization: true,
  showGloss: true,
  toneColors: true,
  theme: 'system',
  thaiFontScale: 1,
}

export async function getSetting<K extends keyof Settings>(
  key: K,
): Promise<Settings[K]> {
  const row = await db.settings.get(key)
  return row ? (row.value as Settings[K]) : SETTINGS_DEFAULTS[key]
}

export async function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<void> {
  const updatedAt = nowIso()
  await db.transaction('rw', db.settings, db.outbox, async () => {
    await db.settings.put({ key, value, updatedAt })
    await enqueueOutbox('settings', SETTINGS_RECORD_ID, updatedAt)
  })
}

/**
 * Reactive read of one setting. Returns the default both while the initial
 * query is loading and when no row has ever been written for `key`, so
 * callers never need to handle an `undefined` state themselves.
 */
export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  const value = useLiveQuery(async () => {
    const row = await db.settings.get(key)
    return row ? (row.value as Settings[K]) : undefined
  }, [key])
  return value === undefined ? SETTINGS_DEFAULTS[key] : value
}
