import { db, DB_SCHEMA_VERSION } from './db'
import type { MetaKey } from './db'
import { newId } from '../lib/ids'

export async function getMetaValue(key: MetaKey): Promise<string | undefined> {
  const row = await db.meta.get(key)
  return row?.value
}

/**
 * Returns this device's stable id, minted once by `ThaiLerDb`'s `populate`
 * hook. Repairs a missing row (e.g. a database created before `meta`
 * existed) rather than throwing, since a device id is required by
 * `snapshot.ts` for every export.
 */
export async function getDeviceId(): Promise<string> {
  const existing = await getMetaValue('deviceId')
  if (existing) return existing
  const fresh = newId()
  await db.meta.put({ key: 'deviceId', value: fresh })
  return fresh
}

export async function getStoredSchemaVersion(): Promise<number> {
  const value = await getMetaValue('schemaVersion')
  return value ? Number(value) : DB_SCHEMA_VERSION
}

/** ISO timestamp of the last successful `src/sync/pull.ts` run, or `null` before the first one. */
export async function getLastPullAt(): Promise<string | null> {
  return (await getMetaValue('lastPullAt')) ?? null
}

export async function setLastPullAt(value: string): Promise<void> {
  await db.meta.put({ key: 'lastPullAt', value })
}

/**
 * Whether `src/sync/index.ts`'s `startSync()` has already run its one-time
 * "enqueue every local record" migration for this device (PLAN.MD §4.5).
 */
export async function getSyncInitialized(): Promise<boolean> {
  return (await getMetaValue('syncInitialized')) === '1'
}

export async function setSyncInitialized(): Promise<void> {
  await db.meta.put({ key: 'syncInitialized', value: '1' })
}
