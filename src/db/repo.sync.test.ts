import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import type { AnnotationRecord, Dialogue, SettingRow } from './db'
import {
  clearOutbox,
  createAnnotation,
  createDialogue,
  finalizeAnnotation,
  mergeRemoteAnnotation,
  mergeRemoteDialogue,
  mergeRemoteSettings,
  renameDialogue,
  setCurrentAnnotation,
  softDeleteDialogue,
  takeOutbox,
} from './repo'
import { setSetting } from './settings'
import { manifestKey } from '../lib/records'

beforeEach(async () => {
  await db.dialogues.clear()
  await db.annotations.clear()
  await db.settings.clear()
  await db.outbox.clear()
})

describe('outbox enqueue on every write path', () => {
  it('createDialogue enqueues one outbox row for the new dialogue', async () => {
    const dialogue = await createDialogue('Somchai: สวัสดีครับ')
    const rows = await takeOutbox()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: manifestKey('dialogue', dialogue.id),
      kind: 'dialogue',
      id: dialogue.id,
      updatedAt: dialogue.updatedAt,
    })
  })

  it('renameDialogue and softDeleteDialogue coalesce into one outbox row (same key)', async () => {
    const dialogue = await createDialogue('Hello')
    await renameDialogue(dialogue.id, 'Renamed')
    await softDeleteDialogue(dialogue.id)

    const rows = await takeOutbox()
    expect(rows).toHaveLength(1)
    const deleted = await db.dialogues.get(dialogue.id)
    expect(rows[0]?.updatedAt).toBe(deleted?.updatedAt)
  })

  it('setCurrentAnnotation enqueues the dialogue', async () => {
    const dialogue = await createDialogue('Hello')
    await db.outbox.clear()
    const annotation = await createAnnotation({
      dialogueId: dialogue.id,
      model: 'claude-opus-5',
      promptVersion: 1,
      lineCount: 1,
    })
    await setCurrentAnnotation(dialogue.id, annotation.id)
    const rows = await takeOutbox()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('dialogue')
    expect(rows[0]?.id).toBe(dialogue.id)
  })

  it('setSetting enqueues the single settings:all outbox entry', async () => {
    await setSetting('theme', 'dark')
    const rows = await takeOutbox()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: 'settings:all',
      kind: 'settings',
      id: 'all',
    })
  })

  it('createAnnotation does not enqueue outbox (deprecated, pre-finalize)', async () => {
    const dialogue = await createDialogue('Hello')
    await db.outbox.clear()
    await createAnnotation({
      dialogueId: dialogue.id,
      model: 'claude-opus-5',
      promptVersion: 1,
      lineCount: 1,
    })
    expect(await takeOutbox()).toHaveLength(0)
  })

  it('finalizeAnnotation sets run.state done and enqueues the annotation', async () => {
    const dialogue = await createDialogue('Hello')
    const annotation = await createAnnotation({
      dialogueId: dialogue.id,
      model: 'claude-opus-5',
      promptVersion: 1,
      lineCount: 1,
    })
    expect(annotation.run.state).toBe('running')
    await db.outbox.clear()

    await finalizeAnnotation(annotation.id)
    const finalized = await db.annotations.get(annotation.id)
    expect(finalized?.run.state).toBe('done')
    expect(finalized?.status).toBe('complete')

    const rows = await takeOutbox()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'annotation', id: annotation.id })
  })
})

describe('clearOutbox', () => {
  it('deletes the row when updatedAt is unchanged', async () => {
    const dialogue = await createDialogue('Hello')
    const [row] = await takeOutbox()
    if (!row) throw new Error('expected an outbox row')
    await clearOutbox(row.key, row.updatedAt)
    expect(await takeOutbox()).toHaveLength(0)
    void dialogue
  })

  it('keeps the row queued if a newer write landed mid-push', async () => {
    const dialogue = await createDialogue('Hello')
    const [row] = await takeOutbox()
    if (!row) throw new Error('expected an outbox row')

    // A write lands "mid-push" — after push read this outbox row, before
    // it clears it — bumping updatedAt.
    await renameDialogue(dialogue.id, 'Renamed mid-push')

    // clearOutbox is called with the *stale* updatedAt push captured.
    await clearOutbox(row.key, row.updatedAt)

    const remaining = await takeOutbox()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.updatedAt).not.toBe(row.updatedAt)
  })
})

describe('mergeRemote*', () => {
  function makeDialogue(overrides: Partial<Dialogue> = {}): Dialogue {
    return {
      id: 'remote-d1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      title: 'Remote',
      sourceText: 'Remote text',
      currentAnnotationId: null,
      ...overrides,
    }
  }

  it('mergeRemoteDialogue writes the incoming record and never enqueues outbox', async () => {
    const remote = makeDialogue()
    const winner = await mergeRemoteDialogue(remote)
    expect(winner).toEqual(remote)
    expect(await db.dialogues.get(remote.id)).toEqual(remote)
    expect(await takeOutbox()).toHaveLength(0)
  })

  it('mergeRemoteDialogue keeps the newer local record and reports it as the winner', async () => {
    const local = makeDialogue({
      updatedAt: '2026-01-02T00:00:00.000Z',
      title: 'Local (newer)',
    })
    await db.dialogues.put(local)
    const remote = makeDialogue({
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'Remote (older)',
    })

    const winner = await mergeRemoteDialogue(remote)
    expect(winner).toEqual(local)
    expect(await db.dialogues.get(local.id)).toEqual(local)
    expect(await takeOutbox()).toHaveLength(0)
  })

  it('mergeRemoteAnnotation never enqueues outbox', async () => {
    const remote: AnnotationRecord = {
      id: 'remote-a1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      dialogueId: 'remote-d1',
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
        steps: 0,
        lastError: null,
      },
    }
    const winner = await mergeRemoteAnnotation(remote)
    expect(winner).toEqual(remote)
    expect(await takeOutbox()).toHaveLength(0)
  })

  it('mergeRemoteSettings merges per-key and never enqueues outbox', async () => {
    const localRow: SettingRow = {
      key: 'theme',
      value: 'light',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    await db.settings.put(localRow)
    const remote: SettingRow[] = [
      { key: 'theme', value: 'dark', updatedAt: '2026-01-02T00:00:00.000Z' },
      {
        key: 'model',
        value: 'claude-sonnet-5',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]

    const merged = await mergeRemoteSettings(remote)
    expect(merged.map((r) => r.key).sort()).toEqual(['model', 'theme'])
    expect((await db.settings.get('theme'))?.value).toBe('dark')
    expect(await takeOutbox()).toHaveLength(0)
  })
})
