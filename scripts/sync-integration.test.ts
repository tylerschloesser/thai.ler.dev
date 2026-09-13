import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetMemoryStoreForTests } from '../api/_lib/store/memory.js'
import type { Dialogue } from '../src/lib/records.js'
import { db } from '../src/db/db.js'
import {
  createDialogue,
  getAnnotation,
  getDialogue,
  renameDialogue,
} from '../src/db/repo.js'
import { setSetting } from '../src/db/settings.js'
import { createApi } from '../src/sync/api.js'
import { pull, push } from '../src/sync/index.js'
import { pollNow, stopAllWatchers, watchAnnotation } from '../src/sync/poll.js'
import { createHandlerFetch } from './testHandlerFetch.js'

/**
 * M1<->M2 integration test (PLAN.MD §5 M2 acceptance): drives the real
 * client sync code (`src/sync/**` + `src/db/**`, fake-indexeddb via
 * `vitest.setup.ts`) against the real M1 handlers in-process, via
 * `createHandlerFetch` (`./testHandlerFetch.ts`) - no HTTP server, no mocks
 * of either side. Lives under `scripts/` (covered by `tsconfig.node.json`'s
 * `include: [..., "scripts"]` and `vitest.config.ts`'s
 * `scripts/**\/*.test.ts`) rather than `src/sync/` or `api/`, specifically so
 * that no runtime file under `api/**` ever imports `src/db` (CLAUDE.md hard
 * rule 1 / `.claude/rules/api.md`'s import rule) - only this test file, and
 * the test-only `./testHandlerFetch.ts` helper, cross that boundary.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const SAMPLE_DIALOGUE_PATH = path.join(
  here,
  '..',
  'src',
  'fixtures',
  'sample.dialogue.txt',
)

function uniqueNs(label: string): string {
  return `int-${label}-${crypto.randomUUID().slice(0, 8)}`
}

beforeEach(async () => {
  resetMemoryStoreForTests()
  process.env['BLOB_BACKEND'] = 'memory'
  process.env['ALLOW_TEST_MODE'] = '1'
  process.env['MODEL_PROVIDER'] = 'fake'
  stopAllWatchers()
  await db.transaction(
    'rw',
    db.dialogues,
    db.annotations,
    db.settings,
    db.outbox,
    db.meta,
    async () => {
      await db.dialogues.clear()
      await db.annotations.clear()
      await db.settings.clear()
      await db.outbox.clear()
      await db.meta.clear()
    },
  )
})

describe('sync integration: push -> server manifest -> wipe -> pull', () => {
  it('round-trips a created+renamed dialogue and a setting through a real device wipe', async () => {
    const cookie = `thai_ns=${uniqueNs('roundtrip')}`
    const api = createApi(createHandlerFetch(cookie))

    const dialogue = await createDialogue('Somchai: สวัสดีครับ')
    await renameDialogue(dialogue.id, 'Renamed title')
    await setSetting('theme', 'dark')

    // (4) push drains the outbox cleanly.
    const pushResult = await push({ api })
    expect(pushResult.failed).toBeNull()
    expect(pushResult.remaining).toBe(0)
    expect(await db.outbox.count()).toBe(0)

    // The server manifest lists both records.
    const manifest = await api.getManifest()
    expect(manifest.entries[`dialogue:${dialogue.id}`]).toBeDefined()
    expect(manifest.entries['settings:all']).toBeDefined()

    const expectedDialogue = await getDialogue(dialogue.id)
    const expectedSettings = await db.settings.toArray()

    // Simulate a new browser: wipe every local table.
    await db.transaction(
      'rw',
      db.dialogues,
      db.annotations,
      db.settings,
      db.outbox,
      db.meta,
      async () => {
        await db.dialogues.clear()
        await db.annotations.clear()
        await db.settings.clear()
        await db.outbox.clear()
        await db.meta.clear()
      },
    )
    expect(await getDialogue(dialogue.id)).toBeUndefined()

    // Pull brings both records back identically.
    const pullResult = await pull({ api })
    expect(pullResult.pulled).toBe(2) // dialogue + settings

    expect(await getDialogue(dialogue.id)).toEqual(expectedDialogue)
    expect(await db.settings.toArray()).toEqual(expectedSettings)

    // (4) a pull never enqueues an outbox row.
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('sync integration: server-side LWW via PUT /api/sync/record', () => {
  it('a newer PUT wins and pull updates local; an older PUT is rejected and pull leaves local unchanged', async () => {
    const cookie = `thai_ns=${uniqueNs('lww')}`
    const api = createApi(createHandlerFetch(cookie))

    const dialogue = await createDialogue('A: hello')
    await push({ api })

    const base = await getDialogue(dialogue.id)
    if (!base) throw new Error('expected the dialogue to exist locally')

    // A newer server-side PUT (a second device) wins outright.
    const newerAt = new Date(Date.parse(base.updatedAt) + 60_000).toISOString()
    const newer: Dialogue = {
      ...base,
      title: 'Newer remote',
      updatedAt: newerAt,
    }
    const newerWinner = (await api.putRecord('dialogue', newer)) as Dialogue
    expect(newerWinner.title).toBe('Newer remote')

    await pull({ api })
    expect((await getDialogue(dialogue.id))?.title).toBe('Newer remote')

    // An older server-side PUT is rejected server-side; pull leaves local untouched.
    const olderAt = new Date(Date.parse(base.updatedAt) - 60_000).toISOString()
    const older: Dialogue = {
      ...base,
      title: 'Older ignored',
      updatedAt: olderAt,
    }
    const olderWinner = (await api.putRecord('dialogue', older)) as Dialogue
    expect(olderWinner.title).toBe('Newer remote') // the stored copy, unchanged

    await pull({ api })
    expect((await getDialogue(dialogue.id))?.title).toBe('Newer remote')
  })

  it('a tombstone wins a tie at the PUT layer', async () => {
    const cookie = `thai_ns=${uniqueNs('lww-tie')}`
    const api = createApi(createHandlerFetch(cookie))

    const dialogue = await createDialogue('A: hello')
    await push({ api })
    const base = await getDialogue(dialogue.id)
    if (!base) throw new Error('expected the dialogue to exist locally')

    // A tombstone PUT at the exact same `updatedAt` as the stored copy wins
    // the tie (`src/lib/merge.ts`'s `pickWinner`) - verified directly
    // against the PUT response, which is where `pickWinner` actually runs.
    const tombstone: Dialogue = {
      ...base,
      title: base.title,
      deletedAt: base.updatedAt,
    }
    const tombstoneWinner = (await api.putRecord(
      'dialogue',
      tombstone,
    )) as Dialogue
    expect(tombstoneWinner.deletedAt).toBe(base.updatedAt)
  })

  it('a tombstoned tie is still visible to a pull once the PUT has landed', async () => {
    const cookie = `thai_ns=${uniqueNs('lww-tie-pull')}`
    const api = createApi(createHandlerFetch(cookie))

    const dialogue = await createDialogue('A: hello')
    await push({ api })
    const base = await getDialogue(dialogue.id)
    if (!base) throw new Error('expected the dialogue to exist locally')

    // A same-instant "read this, then delete it elsewhere" tombstone PUT
    // ties the local `updatedAt` exactly. `src/sync/pull.ts`'s manifest
    // diff mirrors `pickWinner`'s tie-break (not just a plain `>`), so this
    // still reaches the device on the next pull.
    const tombstone: Dialogue = { ...base, deletedAt: base.updatedAt }
    await api.putRecord('dialogue', tombstone)

    await pull({ api })
    expect((await getDialogue(dialogue.id))?.deletedAt).toBe(base.updatedAt)
  })
})

describe('sync integration: annotate end-to-end', () => {
  it('runs the fixture dialogue through the real runner to a complete record', async () => {
    const cookie = `thai_ns=${uniqueNs('annotate')}`
    const api = createApi(createHandlerFetch(cookie))

    const sourceText = readFileSync(SAMPLE_DIALOGUE_PATH, 'utf8')
    const dialogue = await createDialogue(sourceText)

    const { annotation } = await api.annotate({
      dialogue,
      model: 'claude-opus-5',
    })
    expect(annotation.lines).toHaveLength(8)
    expect(annotation.run.state).toMatch(/queued|running|done/)

    watchAnnotation(annotation.id, { api })
    try {
      await expect
        .poll(
          async () => {
            await pollNow()
            const local = await getAnnotation(annotation.id)
            return local?.run.state
          },
          { timeout: 5_000, interval: 20 },
        )
        .toBe('done')
    } finally {
      stopAllWatchers()
    }

    const final = await getAnnotation(annotation.id)
    expect(final?.status).toBe('complete')
    expect(final?.lines.every((line) => line !== null)).toBe(true)
  })
})
