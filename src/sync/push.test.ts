import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './../db/db'
import { createDialogue, renameDialogue, takeOutbox } from '../db/repo'
import { setSetting } from '../db/settings'
import { push } from './push'
import { ApiError } from './api'
import type { SyncApi } from './api'

beforeEach(async () => {
  await db.dialogues.clear()
  await db.annotations.clear()
  await db.settings.clear()
  await db.outbox.clear()
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

describe('push', () => {
  it('drains the outbox, PUTs each row, merges the winner back, and clears it', async () => {
    const dialogue = await createDialogue('Hello')
    const puts: unknown[] = []
    const api = stubApi({
      putRecord: async (kind, record) => {
        puts.push({ kind, record })
        return record // server agrees with us — we're the winner
      },
    })

    const counts = await push({ api })
    expect(counts).toEqual({ pushed: 1, remaining: 0, failed: null })
    expect(puts).toHaveLength(1)
    expect(await takeOutbox()).toHaveLength(0)
    void dialogue
  })

  it('leaves a row queued and reports failed: "error" when the PUT fails with a non-offline error', async () => {
    await createDialogue('Hello')
    const api = stubApi({
      putRecord: async () => {
        throw new ApiError('store', 'blob store suspended', 502)
      },
    })

    const counts = await push({ api })
    expect(counts).toEqual({ pushed: 0, remaining: 1, failed: 'error' })
    expect(await takeOutbox()).toHaveLength(1)
  })

  it('stops draining immediately and reports failed: "offline" on an offline error', async () => {
    await createDialogue('First')
    await createDialogue('Second')
    let calls = 0
    const api = stubApi({
      putRecord: async () => {
        calls += 1
        throw new ApiError('offline', 'no network', 0)
      },
    })

    const counts = await push({ api })
    expect(calls).toBe(1) // stopped after the first offline failure
    expect(counts.pushed).toBe(0)
    expect(counts.remaining).toBe(2)
    expect(counts.failed).toBe('offline')
  })

  it('a write that lands mid-push (during the PUT) stays queued after push finishes', async () => {
    const dialogue = await createDialogue('Hello')
    const api = stubApi({
      putRecord: async (_kind, record) => {
        // Simulate a local edit landing while this PUT is in flight — it
        // re-enqueues the same outbox key with a newer updatedAt.
        await renameDialogue(dialogue.id, 'Renamed mid-flight')
        return record
      },
    })

    await push({ api })
    const remaining = await takeOutbox()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe(dialogue.id)
  })

  it('pushes settings as the whole row array', async () => {
    await setSetting('theme', 'dark')
    const api = stubApi({
      putRecord: async (kind, record) => {
        expect(kind).toBe('settings')
        expect(Array.isArray(record)).toBe(true)
        return record
      },
    })

    const counts = await push({ api })
    expect(counts).toEqual({ pushed: 1, remaining: 0, failed: null })
  })

  it('is a no-op when the outbox is empty', async () => {
    const api = stubApi({})
    const counts = await push({ api })
    expect(counts).toEqual({ pushed: 0, remaining: 0, failed: null })
  })

  it('reports failed: "error" (not "offline") when multiple rows all fail non-offline', async () => {
    await createDialogue('First')
    await createDialogue('Second')
    const api = stubApi({
      putRecord: async () => {
        throw new ApiError('provider', 'model overloaded', 502)
      },
    })

    const counts = await push({ api })
    expect(counts).toEqual({ pushed: 0, remaining: 2, failed: 'error' })
  })
})
