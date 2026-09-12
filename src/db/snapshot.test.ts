import { beforeEach, describe, expect, it } from 'vitest'
import { db, DB_SCHEMA_VERSION } from './db'
import type { Dialogue } from './db'
import {
  exportSnapshot,
  importSnapshot,
  mergeSnapshot,
  SNAPSHOT_FORMAT,
} from './snapshot'
import type { Snapshot } from './snapshot'
import { createDialogue, listDialoguesAsync, softDeleteDialogue } from './repo'

beforeEach(async () => {
  await db.dialogues.clear()
  await db.annotations.clear()
  await db.settings.clear()
})

function emptySnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    format: SNAPSHOT_FORMAT,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: '2026-01-01T00:00:00.000Z',
    deviceId: 'device-a',
    dialogues: [],
    annotations: [],
    settings: [],
    ...overrides,
  }
}

function makeDialogue(overrides: Partial<Dialogue>): Dialogue {
  return {
    id: 'd1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    title: 'Title',
    sourceText: 'Hello',
    currentAnnotationId: null,
    ...overrides,
  }
}

describe('mergeSnapshot', () => {
  it('takes the newer record by updatedAt (last-writer-wins)', () => {
    const local = emptySnapshot({
      dialogues: [
        makeDialogue({ updatedAt: '2026-01-01T00:00:00.000Z', title: 'Old' }),
      ],
    })
    const incoming = emptySnapshot({
      dialogues: [
        makeDialogue({ updatedAt: '2026-01-02T00:00:00.000Z', title: 'New' }),
      ],
    })
    const result = mergeSnapshot(local, incoming)
    expect(result.dialogues).toHaveLength(1)
    expect(result.dialogues[0]?.title).toBe('New')
    expect(result.counts).toEqual({ added: 0, updated: 1, skipped: 0 })
  })

  it('keeps the local record when incoming is older', () => {
    const local = emptySnapshot({
      dialogues: [
        makeDialogue({
          updatedAt: '2026-01-02T00:00:00.000Z',
          title: 'Newer local',
        }),
      ],
    })
    const incoming = emptySnapshot({
      dialogues: [
        makeDialogue({
          updatedAt: '2026-01-01T00:00:00.000Z',
          title: 'Older incoming',
        }),
      ],
    })
    const result = mergeSnapshot(local, incoming)
    expect(result.dialogues[0]?.title).toBe('Newer local')
    expect(result.counts).toEqual({ added: 0, updated: 0, skipped: 1 })
  })

  it('a tombstone beats a same-timestamp live record', () => {
    const ts = '2026-01-01T00:00:00.000Z'
    const local = emptySnapshot({
      dialogues: [makeDialogue({ updatedAt: ts, deletedAt: null })],
    })
    const incoming = emptySnapshot({
      dialogues: [makeDialogue({ updatedAt: ts, deletedAt: ts })],
    })
    const result = mergeSnapshot(local, incoming)
    expect(result.dialogues[0]?.deletedAt).toBe(ts)
    expect(result.counts.updated).toBe(1)
  })

  it('does not resurrect a tombstone via an older live copy', () => {
    const local = emptySnapshot({
      dialogues: [
        makeDialogue({
          updatedAt: '2026-01-05T00:00:00.000Z',
          deletedAt: '2026-01-05T00:00:00.000Z',
        }),
      ],
    })
    const incoming = emptySnapshot({
      dialogues: [
        makeDialogue({
          updatedAt: '2026-01-01T00:00:00.000Z',
          deletedAt: null,
        }),
      ],
    })
    const result = mergeSnapshot(local, incoming)
    expect(result.dialogues[0]?.deletedAt).toBe('2026-01-05T00:00:00.000Z')
    expect(result.counts).toEqual({ added: 0, updated: 0, skipped: 1 })
  })

  it('adds a record that only exists in incoming', () => {
    const local = emptySnapshot()
    const incoming = emptySnapshot({
      dialogues: [makeDialogue({ id: 'brand-new' })],
    })
    const result = mergeSnapshot(local, incoming)
    expect(result.dialogues.map((d) => d.id)).toEqual(['brand-new'])
    expect(result.counts).toEqual({ added: 1, updated: 0, skipped: 0 })
  })

  it('throws a readable error for an unknown schemaVersion', () => {
    const local = emptySnapshot()
    const incoming = emptySnapshot({ schemaVersion: 999 })
    expect(() => mergeSnapshot(local, incoming)).toThrow(/schemaVersion 999/)
  })

  it('throws a readable error for an unrecognized format', () => {
    const local = emptySnapshot()
    const incoming = emptySnapshot({
      format: 'something-else' as unknown as typeof SNAPSHOT_FORMAT,
    })
    expect(() => mergeSnapshot(local, incoming)).toThrow(/unrecognized format/)
  })
})

describe('export / import round trip', () => {
  it('importing an export into an empty db reproduces the data', async () => {
    await createDialogue('Somchai: สวัสดีครับ')
    await createDialogue('Nok: สวัสดีค่ะ')
    const snapshot = await exportSnapshot()
    expect(snapshot.dialogues).toHaveLength(2)

    await db.dialogues.clear()
    expect(await listDialoguesAsync()).toHaveLength(0)

    const counts = await importSnapshot(snapshot)
    expect(counts.added).toBe(2)

    const restored = await listDialoguesAsync()
    expect(restored.map((d) => d.sourceText).sort()).toEqual(
      snapshot.dialogues.map((d) => d.sourceText).sort(),
    )
  })

  it('import never wipes data that only exists locally', async () => {
    const local = await createDialogue('Local only dialogue')
    const incoming = emptySnapshot({
      dialogues: [makeDialogue({ id: 'from-elsewhere' })],
    })

    const counts = await importSnapshot(incoming)
    expect(counts.added).toBe(1)

    const all = await listDialoguesAsync()
    expect(all.map((d) => d.id).sort()).toEqual(
      ['from-elsewhere', local.id].sort(),
    )
  })

  it('rejects an incoming snapshot with an unsupported schemaVersion', async () => {
    await createDialogue('Keep me')
    const bad = emptySnapshot({ schemaVersion: 42 })
    await expect(importSnapshot(bad)).rejects.toThrow(/schemaVersion 42/)
    // Local data must be untouched by the rejected import.
    expect(await listDialoguesAsync()).toHaveLength(1)
  })
})

describe('softDeleteDialogue + export', () => {
  it('exports tombstoned rows so they can propagate to other devices', async () => {
    const d = await createDialogue('Will be deleted')
    await softDeleteDialogue(d.id)
    const snapshot = await exportSnapshot()
    const exported = snapshot.dialogues.find((row) => row.id === d.id)
    expect(exported?.deletedAt).not.toBeNull()
  })
})
