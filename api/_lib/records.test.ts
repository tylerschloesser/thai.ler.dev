import { beforeEach, describe, expect, it } from 'vitest'
import type {
  AnnotationRecord,
  Dialogue,
  SettingRow,
} from '../../src/lib/records.js'
import { LEGACY_RUN, manifestKey } from '../../src/lib/records.js'
import { createRecordsApi } from './records.js'
import { createMemoryStore, resetMemoryStoreForTests } from './store/memory.js'
import type { BlobStore } from './store/index.js'
import { StorePreconditionError } from './store/index.js'

const PREFIX = 'v1/'

function dialogue(overrides: Partial<Dialogue> = {}): Dialogue {
  return {
    id: 'd1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    title: 'Test dialogue',
    sourceText: 'A: hi',
    currentAnnotationId: null,
    ...overrides,
  }
}

function annotation(
  overrides: Partial<AnnotationRecord> = {},
): AnnotationRecord {
  return {
    id: 'a1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    dialogueId: 'd1',
    model: 'claude-opus-5',
    promptVersion: 2,
    schemaVersion: 1,
    lines: [null],
    lineErrors: [null],
    status: 'partial',
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    durationMs: 0,
    run: LEGACY_RUN,
    ...overrides,
  }
}

/** Counts `put`/`get`/`list` calls, for asserting the ops budget (PLAN.MD §4.3). */
function withOpCounts(store: BlobStore): {
  store: BlobStore
  counts: { get: number; put: number; list: number; del: number }
} {
  const counts = { get: 0, put: 0, list: 0, del: 0 }
  return {
    counts,
    store: {
      async getJson(path) {
        counts.get += 1
        return store.getJson(path)
      },
      async putJson(path, value, opts) {
        counts.put += 1
        return store.putJson(path, value, opts)
      },
      async list(prefix) {
        counts.list += 1
        return store.list(prefix)
      },
      async del(urls) {
        counts.del += 1
        return store.del(urls)
      },
    },
  }
}

beforeEach(() => {
  resetMemoryStoreForTests()
})

describe('createRecordsApi', () => {
  it('get returns null for a missing record', async () => {
    const records = createRecordsApi(createMemoryStore(), PREFIX)
    expect(await records.getDialogue('nope')).toBeNull()
    expect(await records.getAnnotation('nope')).toBeNull()
  })

  it('getSettings returns [] when none exist', async () => {
    const records = createRecordsApi(createMemoryStore(), PREFIX)
    expect(await records.getSettings()).toEqual([])
  })

  it('getManifest returns an empty manifest and never writes when none exists', async () => {
    const { store, counts } = withOpCounts(createMemoryStore())
    const records = createRecordsApi(store, PREFIX)
    const manifest = await records.getManifest()
    expect(manifest.entries).toEqual({})
    expect(counts.put).toBe(0)
  })

  it('putRecords writes each blob and folds all entries into one manifest write', async () => {
    const { store, counts } = withOpCounts(createMemoryStore())
    const records = createRecordsApi(store, PREFIX)
    const d = dialogue()
    const a = annotation()

    await records.putRecords(
      [
        { kind: 'dialogue', id: d.id, value: d },
        { kind: 'annotation', id: a.id, value: a },
      ],
      { manifest: true },
    )

    expect(await records.getDialogue(d.id)).toEqual(d)
    expect(await records.getAnnotation(a.id)).toEqual(a)

    const manifest = await records.getManifest()
    expect(Object.keys(manifest.entries)).toEqual(
      expect.arrayContaining([
        manifestKey('dialogue', d.id),
        manifestKey('annotation', a.id),
      ]),
    )

    // 2 record puts + exactly 1 manifest put covering both entries.
    expect(counts.put).toBe(3)
  })

  it('putRecords with manifest:false only touches the record blob(s)', async () => {
    const { store, counts } = withOpCounts(createMemoryStore())
    const records = createRecordsApi(store, PREFIX)
    const a = annotation()

    await records.putRecords([{ kind: 'annotation', id: a.id, value: a }], {
      manifest: false,
    })

    expect(counts.put).toBe(1)
    expect(counts.get).toBe(0)
    const manifest = await records.getManifest()
    expect(manifest.entries).toEqual({})
  })

  it('settings manifest entry uses settingsUpdatedAt, not a wall-clock timestamp', async () => {
    const records = createRecordsApi(createMemoryStore(), PREFIX)
    const rows: SettingRow[] = [
      {
        key: 'model',
        value: 'claude-opus-5',
        updatedAt: '2020-01-01T00:00:00.000Z',
      },
    ]
    await records.putRecords([{ kind: 'settings', id: 'all', value: rows }], {
      manifest: true,
    })
    const manifest = await records.getManifest()
    expect(manifest.entries['settings:all']).toMatchObject({
      kind: 'settings',
      id: 'all',
      updatedAt: '2020-01-01T00:00:00.000Z',
      deletedAt: null,
    })
  })

  it('retries once on a manifest ifMatch conflict, then succeeds', async () => {
    const backing = createMemoryStore()
    let putCalls = 0
    const flaky: BlobStore = {
      getJson: (path) => backing.getJson(path),
      list: (prefix) => backing.list(prefix),
      del: (urls) => backing.del(urls),
      async putJson(path, value, opts) {
        if (path === 'v1/manifest.json') {
          putCalls += 1
          if (putCalls === 1) {
            // Simulate a concurrent writer landing between our read and write.
            await backing.putJson(path, { concurrent: true })
            throw new StorePreconditionError(path)
          }
        }
        return backing.putJson(path, value, opts)
      },
    }
    const records = createRecordsApi(flaky, PREFIX)
    const a = annotation()
    await records.putRecords([{ kind: 'annotation', id: a.id, value: a }], {
      manifest: true,
    })
    const manifest = await records.getManifest()
    expect(manifest.entries[manifestKey('annotation', a.id)]).toBeDefined()
    expect(putCalls).toBe(2)
  })

  it('fails with a store HttpError after a second conflicting manifest write', async () => {
    const backing = createMemoryStore()
    const alwaysConflicts: BlobStore = {
      getJson: (path) => backing.getJson(path),
      list: (prefix) => backing.list(prefix),
      del: (urls) => backing.del(urls),
      async putJson(path, value, opts) {
        if (path === 'v1/manifest.json') {
          throw new StorePreconditionError(path)
        }
        return backing.putJson(path, value, opts)
      },
    }
    const records = createRecordsApi(alwaysConflicts, PREFIX)
    const a = annotation()
    await expect(
      records.putRecords([{ kind: 'annotation', id: a.id, value: a }], {
        manifest: true,
      }),
    ).rejects.toMatchObject({ kind: 'store' })
  })

  it('rebuildManifest lists every record and rewrites the manifest from scratch', async () => {
    const records = createRecordsApi(createMemoryStore(), PREFIX)
    const d = dialogue()
    const a = annotation()
    const rows: SettingRow[] = [
      {
        key: 'model',
        value: 'claude-opus-5',
        updatedAt: '2020-01-01T00:00:00.000Z',
      },
    ]
    await records.putRecords(
      [
        { kind: 'dialogue', id: d.id, value: d },
        { kind: 'annotation', id: a.id, value: a },
        { kind: 'settings', id: 'all', value: rows },
      ],
      { manifest: false },
    )

    const manifest = await records.rebuildManifest()
    expect(Object.keys(manifest.entries).sort()).toEqual(
      ['annotation:a1', 'dialogue:d1', 'settings:all'].sort(),
    )
  })

  it('resolveDialogueUpsert: no existing record always wins', async () => {
    const records = createRecordsApi(createMemoryStore(), PREFIX)
    const d = dialogue()
    const result = await records.resolveDialogueUpsert(d)
    expect(result).toEqual({ record: d, changed: true })
  })

  it('resolveDialogueUpsert: an older incoming record loses (skip the put)', async () => {
    const records = createRecordsApi(createMemoryStore(), PREFIX)
    const existing = dialogue({
      updatedAt: '2026-01-02T00:00:00.000Z',
      title: 'Newer',
    })
    await records.putRecords(
      [{ kind: 'dialogue', id: existing.id, value: existing }],
      {
        manifest: false,
      },
    )
    const older = dialogue({
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'Older',
    })
    const result = await records.resolveDialogueUpsert(older)
    expect(result).toEqual({ record: existing, changed: false })
  })

  it('resolveDialogueUpsert: a newer incoming record wins', async () => {
    const records = createRecordsApi(createMemoryStore(), PREFIX)
    const existing = dialogue({ updatedAt: '2026-01-01T00:00:00.000Z' })
    await records.putRecords(
      [{ kind: 'dialogue', id: existing.id, value: existing }],
      {
        manifest: false,
      },
    )
    const newer = dialogue({
      updatedAt: '2026-01-02T00:00:00.000Z',
      title: 'Newer',
    })
    const winner = await records.resolveDialogueUpsert(newer)
    expect(winner).toEqual({ record: newer, changed: true })
  })

  it('resolveAnnotationUpsert follows the same LWW rule', async () => {
    const records = createRecordsApi(createMemoryStore(), PREFIX)
    const existing = annotation({ updatedAt: '2026-01-02T00:00:00.000Z' })
    await records.putRecords(
      [{ kind: 'annotation', id: existing.id, value: existing }],
      { manifest: false },
    )
    const older = annotation({ updatedAt: '2026-01-01T00:00:00.000Z' })
    expect(await records.resolveAnnotationUpsert(older)).toEqual({
      record: existing,
      changed: false,
    })
  })

  it('resolveSettingsUpsert merges and reports unchanged when the merge equals the stored rows', async () => {
    const records = createRecordsApi(createMemoryStore(), PREFIX)
    const rows: SettingRow[] = [
      {
        key: 'model',
        value: 'claude-opus-5',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    await records.putRecords([{ kind: 'settings', id: 'all', value: rows }], {
      manifest: false,
    })

    const staleIncoming: SettingRow[] = [
      {
        key: 'model',
        value: 'claude-sonnet-5',
        updatedAt: '2020-01-01T00:00:00.000Z',
      },
    ]
    const unchanged = await records.resolveSettingsUpsert(staleIncoming)
    expect(unchanged.changed).toBe(false)
    expect(unchanged.record).toEqual(rows)

    const freshIncoming: SettingRow[] = [
      {
        key: 'model',
        value: 'claude-sonnet-5',
        updatedAt: '2030-01-01T00:00:00.000Z',
      },
    ]
    const changed = await records.resolveSettingsUpsert(freshIncoming)
    expect(changed.changed).toBe(true)
    expect(changed.record).toEqual(freshIncoming)
  })
})
