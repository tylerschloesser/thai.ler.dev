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
