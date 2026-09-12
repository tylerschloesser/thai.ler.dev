import type {
  AnnotationRecord,
  Dialogue,
  Manifest,
  ManifestEntry,
  SettingRow,
} from '../../src/lib/records.js'
import {
  emptyManifest,
  manifestKey,
  SETTINGS_RECORD_ID,
} from '../../src/lib/records.js'
import {
  pickWinner,
  mergeSettingRows,
  settingsUpdatedAt,
} from '../../src/lib/merge.js'
import { nowIso } from '../../src/lib/time.js'
import { HttpError } from './http.js'
import type { BlobStore } from './store/index.js'
import {
  manifestPath,
  recordPath,
  settingsPath,
  StorePreconditionError,
} from './store/index.js'

/**
 * Blob-backed record CRUD + manifest maintenance (PLAN.MD §4.3, §10).
 * Every read is fresh (`BlobStore.getJson` always bypasses caches on the
 * `vercel` backend - see `api/_lib/store/vercel.ts`). Intermediate runner
 * flushes call `putRecords([...], { manifest: false })`, which touches only
 * the record blob(s); job creation and job end call it with
 * `{ manifest: true }`, which additionally folds every entry into ONE
 * manifest read-modify-write (retried once on an `ifMatch` conflict).
 */

export type PutEntry =
  | { kind: 'dialogue'; id: string; value: Dialogue }
  | { kind: 'annotation'; id: string; value: AnnotationRecord }
  | { kind: 'settings'; id: typeof SETTINGS_RECORD_ID; value: SettingRow[] }

export interface RecordsApi {
  getDialogue(id: string): Promise<Dialogue | null>
  getAnnotation(id: string): Promise<AnnotationRecord | null>
  getSettings(): Promise<SettingRow[]>
  getManifest(): Promise<Manifest>
  putRecords(entries: PutEntry[], opts: { manifest: boolean }): Promise<void>
  rebuildManifest(): Promise<Manifest>
  resolveDialogueUpsert(
    incoming: Dialogue,
  ): Promise<{ record: Dialogue; changed: boolean }>
  resolveAnnotationUpsert(
    incoming: AnnotationRecord,
  ): Promise<{ record: AnnotationRecord; changed: boolean }>
  resolveSettingsUpsert(
    incoming: SettingRow[],
  ): Promise<{ record: SettingRow[]; changed: boolean }>
}

function pathFor(prefix: string, entry: PutEntry): string {
  if (entry.kind === 'settings') return settingsPath(prefix)
  return recordPath(prefix, entry.kind, entry.id)
}

function toManifestEntry(entry: PutEntry, now: string): ManifestEntry {
  if (entry.kind === 'settings') {
    return {
      kind: 'settings',
      id: SETTINGS_RECORD_ID,
      updatedAt: settingsUpdatedAt(entry.value, now),
      deletedAt: null,
    }
  }
  return {
    kind: entry.kind,
    id: entry.value.id,
    updatedAt: entry.value.updatedAt,
    deletedAt: entry.value.deletedAt,
  }
}

export function createRecordsApi(store: BlobStore, prefix: string): RecordsApi {
  // The `memory` backend (`api/_lib/store/memory.ts`) stores values by
  // reference, unlike `disk`/`vercel` which round-trip through JSON - so a
  // caller mutating a fetched record in place (the runner does, heavily)
  // would silently corrupt the "stored" copy before any `putJson` call.
  // Cloning on every read makes all three backends behave identically.
  async function getDialogue(id: string): Promise<Dialogue | null> {
    const res = await store.getJson<Dialogue>(
      recordPath(prefix, 'dialogue', id),
    )
    return res ? structuredClone(res.value) : null
  }

  async function getAnnotation(id: string): Promise<AnnotationRecord | null> {
    const res = await store.getJson<AnnotationRecord>(
      recordPath(prefix, 'annotation', id),
    )
    return res ? structuredClone(res.value) : null
  }

  async function getSettings(): Promise<SettingRow[]> {
    const res = await store.getJson<SettingRow[]>(settingsPath(prefix))
    return res ? structuredClone(res.value) : []
  }

  async function getManifestWithEtag(): Promise<{
    manifest: Manifest
    etag: string | undefined
  }> {
    const res = await store.getJson<Manifest>(manifestPath(prefix))
    return { manifest: res?.value ?? emptyManifest(nowIso()), etag: res?.etag }
  }

  async function getManifest(): Promise<Manifest> {
    return (await getManifestWithEtag()).manifest
  }

  async function updateManifestEntries(
    newEntries: ManifestEntry[],
  ): Promise<Manifest> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { manifest: current, etag } = await getManifestWithEtag()
      const next: Manifest = {
        ...current,
        entries: { ...current.entries },
        updatedAt: nowIso(),
      }
      for (const entry of newEntries) {
        next.entries[manifestKey(entry.kind, entry.id)] = entry
      }
      try {
        await store.putJson(manifestPath(prefix), next, { ifMatch: etag })
        return next
      } catch (err) {
        if (!(err instanceof StorePreconditionError) || attempt === 1) {
          throw new HttpError(
            'store',
            'failed to update the manifest after a conflicting write',
          )
        }
        // retry once, re-reading the manifest that just changed under us
      }
    }
    /* istanbul ignore next - unreachable: the loop above always returns or throws */
    throw new HttpError('store', 'failed to update the manifest')
  }

  async function putRecords(
    entries: PutEntry[],
    opts: { manifest: boolean },
  ): Promise<void> {
    for (const entry of entries) {
      await store.putJson(pathFor(prefix, entry), entry.value)
    }
    if (opts.manifest && entries.length > 0) {
      const now = nowIso()
      await updateManifestEntries(
        entries.map((entry) => toManifestEntry(entry, now)),
      )
    }
  }

  async function rebuildManifest(): Promise<Manifest> {
    const [dialogueBlobs, annotationBlobs] = await Promise.all([
      store.list(`${prefix}dialogues/`),
      store.list(`${prefix}annotations/`),
    ])

    const entries: Record<string, ManifestEntry> = {}

    for (const blob of dialogueBlobs) {
      const res = await store.getJson<Dialogue>(blob.pathname)
      if (!res) continue
      entries[manifestKey('dialogue', res.value.id)] = {
        kind: 'dialogue',
        id: res.value.id,
        updatedAt: res.value.updatedAt,
        deletedAt: res.value.deletedAt,
      }
    }

    for (const blob of annotationBlobs) {
      const res = await store.getJson<AnnotationRecord>(blob.pathname)
      if (!res) continue
      entries[manifestKey('annotation', res.value.id)] = {
        kind: 'annotation',
        id: res.value.id,
        updatedAt: res.value.updatedAt,
        deletedAt: res.value.deletedAt,
      }
    }

    const settingsRes = await store.getJson<SettingRow[]>(settingsPath(prefix))
    if (settingsRes && settingsRes.value.length > 0) {
      entries[manifestKey('settings', SETTINGS_RECORD_ID)] = {
        kind: 'settings',
        id: SETTINGS_RECORD_ID,
        updatedAt: settingsUpdatedAt(settingsRes.value, nowIso()),
        deletedAt: null,
      }
    }

    const manifest: Manifest = { ...emptyManifest(nowIso()), entries }
    await store.putJson(manifestPath(prefix), manifest)
    return manifest
  }

  async function resolveDialogueUpsert(
    incoming: Dialogue,
  ): Promise<{ record: Dialogue; changed: boolean }> {
    const existing = await getDialogue(incoming.id)
    if (!existing) return { record: incoming, changed: true }
    return pickWinner(existing, incoming) === 'incoming'
      ? { record: incoming, changed: true }
      : { record: existing, changed: false }
  }

  async function resolveAnnotationUpsert(
    incoming: AnnotationRecord,
  ): Promise<{ record: AnnotationRecord; changed: boolean }> {
    const existing = await getAnnotation(incoming.id)
    if (!existing) return { record: incoming, changed: true }
    return pickWinner(existing, incoming) === 'incoming'
      ? { record: incoming, changed: true }
      : { record: existing, changed: false }
  }

  async function resolveSettingsUpsert(
    incoming: SettingRow[],
  ): Promise<{ record: SettingRow[]; changed: boolean }> {
    const existing = await getSettings()
    const merged = mergeSettingRows(existing, incoming)
    const changed = JSON.stringify(merged) !== JSON.stringify(existing)
    return { record: merged, changed }
  }

  return {
    getDialogue,
    getAnnotation,
    getSettings,
    getManifest,
    putRecords,
    rebuildManifest,
    resolveDialogueUpsert,
    resolveAnnotationUpsert,
    resolveSettingsUpsert,
  }
}
