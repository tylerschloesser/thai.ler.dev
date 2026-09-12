import { beforeEach, describe, expect, it } from 'vitest'
import type { Manifest } from '../lib/records'
import { manifestKey } from '../lib/records'
import { db } from '../db/db'
import { getDialogue, getAnnotation } from '../db/repo'
import { getLastPullAt } from '../db/meta'
import { pull } from './pull'
import type { SyncApi } from './api'

beforeEach(async () => {
  await db.dialogues.clear()
  await db.annotations.clear()
  await db.settings.clear()
  await db.outbox.clear()
  await db.meta.clear()
})

function stubApi(overrides: Partial<SyncApi>): SyncApi {
  return {
    getManifest: async () => {
      throw new Error('not stubbed')
    },
    getRecord: async () => {
      throw new Error('not stubbed')
    },
    putRecord: async () => {
      throw new Error('not stubbed')
    },
    getAnnotation: async () => {
      throw new Error('not stubbed')
    },
    annotate: async () => {
      throw new Error('not stubbed')
    },
    resumeAnnotation: async () => {
      throw new Error('not stubbed')
    },
    cancelAnnotation: async () => {
      throw new Error('not stubbed')
    },
    rebuildManifest: async () => {
      throw new Error('not stubbed')
    },
    ...overrides,
  }
}

function manifest(entries: Manifest['entries']): Manifest {
  return {
    format: 'thai.ler.dev/manifest',
    version: 1,
    updatedAt: 'x',
    entries,
  }
}

describe('pull', () => {
  it('fetches and merges every entry not already up to date locally, and sets lastPullAt', async () => {
    const remoteDialogue = {
      id: 'd1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      deletedAt: null,
      title: 'Remote title',
      sourceText: 'Hello',
      currentAnnotationId: null,
    }
    const api = stubApi({
      getManifest: async () =>
        manifest({
          [manifestKey('dialogue', 'd1')]: {
            kind: 'dialogue',
            id: 'd1',
            updatedAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
          },
        }),
      getRecord: async (kind, id) => {
        expect(kind).toBe('dialogue')
        expect(id).toBe('d1')
        return remoteDialogue
      },
    })

    expect(await getLastPullAt()).toBeNull()
    const counts = await pull({ api })
    expect(counts).toEqual({ pulled: 1, skipped: 0 })
    expect(await getDialogue('d1')).toEqual(remoteDialogue)
    expect(await getLastPullAt()).not.toBeNull()
  })

  it('skips an entry whose local copy is already at least as new', async () => {
    await db.dialogues.put({
      id: 'd1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      deletedAt: null,
      title: 'Local (already current)',
      sourceText: 'Hello',
      currentAnnotationId: null,
    })
    const api = stubApi({
      getManifest: async () =>
        manifest({
          [manifestKey('dialogue', 'd1')]: {
            kind: 'dialogue',
            id: 'd1',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: null,
          },
        }),
      getRecord: async () => {
        throw new Error('should not fetch an up-to-date record')
      },
    })

    const counts = await pull({ api })
    expect(counts).toEqual({ pulled: 0, skipped: 1 })
  })

  it('merges a remote annotation record', async () => {
    const remoteAnnotation = {
      id: 'a1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      deletedAt: null,
      dialogueId: 'd1',
      model: 'claude-opus-5',
      promptVersion: 1,
      schemaVersion: 1,
      lines: [],
      lineErrors: [],
      status: 'complete',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      durationMs: 0,
      run: {
        state: 'done',
        provider: 'anthropic',
        leaseUntil: null,
        hops: 0,
        steps: 1,
        lastError: null,
      },
    }
    const api = stubApi({
      getManifest: async () =>
        manifest({
          [manifestKey('annotation', 'a1')]: {
            kind: 'annotation',
            id: 'a1',
            updatedAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
          },
        }),
      getRecord: async () => remoteAnnotation,
    })

    await pull({ api })
    expect(await getAnnotation('a1')).toEqual(remoteAnnotation)
  })

  it('pulls settings when local has none yet', async () => {
    const remoteSettings = [
      { key: 'theme', value: 'dark', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]
    const api = stubApi({
      getManifest: async () =>
        manifest({
          'settings:all': {
            kind: 'settings',
            id: 'all',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: null,
          },
        }),
      getRecord: async () => remoteSettings,
    })

    const counts = await pull({ api })
    expect(counts.pulled).toBe(1)
    expect((await db.settings.get('theme'))?.value).toBe('dark')
  })
})
