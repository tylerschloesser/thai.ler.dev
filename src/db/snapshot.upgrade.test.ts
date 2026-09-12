import { beforeEach, describe, expect, it } from 'vitest'
import { db, DB_SCHEMA_VERSION, LEGACY_RUN } from './db'
import type { AnnotationRecord, Dialogue } from './db'
import { importSnapshot, SNAPSHOT_FORMAT, upgradeSnapshot } from './snapshot'
import type { Snapshot } from './snapshot'
import { createDialogue } from './repo'
import { manifestKey } from '../lib/records'

beforeEach(async () => {
  await db.dialogues.clear()
  await db.annotations.clear()
  await db.settings.clear()
  await db.outbox.clear()
})

function makeDialogue(overrides: Partial<Dialogue> = {}): Dialogue {
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

function makeAnnotation(
  overrides: Partial<AnnotationRecord> = {},
): AnnotationRecord {
  return {
    id: 'a1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
    run: LEGACY_RUN,
    ...overrides,
  }
}

function v1Snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    format: SNAPSHOT_FORMAT,
    schemaVersion: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    deviceId: 'device-a',
    dialogues: [],
    // Cast away `run` at the type level to model a real v1 file, which
    // never had the field at all.
    annotations: [] as AnnotationRecord[],
    settings: [],
    ...overrides,
  }
}

describe('upgradeSnapshot', () => {
  it('accepts schemaVersion 1 and stamps LEGACY_RUN on every annotation', () => {
    const legacyAnnotation = {
      ...makeAnnotation(),
    } as Partial<AnnotationRecord>
    delete legacyAnnotation.run
    const incoming = v1Snapshot({
      annotations: [legacyAnnotation as AnnotationRecord],
    })

    const upgraded = upgradeSnapshot(incoming)
    expect(upgraded.schemaVersion).toBe(DB_SCHEMA_VERSION)
    expect(upgraded.annotations[0]?.run).toEqual(LEGACY_RUN)
  })

  it('defaults a missing run on a schemaVersion 2 snapshot too', () => {
    const withoutRun = { ...makeAnnotation() } as Partial<AnnotationRecord>
    delete withoutRun.run
    const incoming = v1Snapshot({
      schemaVersion: 2,
      annotations: [withoutRun as AnnotationRecord],
    })

    const upgraded = upgradeSnapshot(incoming)
    expect(upgraded.annotations[0]?.run).toEqual(LEGACY_RUN)
  })

  it('leaves an existing run untouched', () => {
    const running = makeAnnotation({
      run: {
        state: 'running',
        provider: 'fake',
        leaseUntil: null,
        hops: 0,
        steps: 1,
        lastError: null,
      },
    })
    const incoming = v1Snapshot({ schemaVersion: 2, annotations: [running] })
    const upgraded = upgradeSnapshot(incoming)
    expect(upgraded.annotations[0]?.run.state).toBe('running')
  })

  it('refuses schemaVersion 3', () => {
    const incoming = v1Snapshot({ schemaVersion: 3 })
    expect(() => upgradeSnapshot(incoming)).toThrow(/schemaVersion 3/)
  })
})

describe('importSnapshot enqueues outbox rows', () => {
  it('enqueues exactly the dialogues/annotations/settings that changed', async () => {
    const untouched = await createDialogue('Untouched locally')
    await db.outbox.clear()

    const incoming = v1Snapshot({
      schemaVersion: DB_SCHEMA_VERSION,
      dialogues: [makeDialogue({ id: 'new-d1' })],
      annotations: [makeAnnotation({ id: 'new-a1', dialogueId: 'new-d1' })],
      settings: [
        { key: 'theme', value: 'dark', updatedAt: '2026-01-05T00:00:00.000Z' },
      ],
    })

    const counts = await importSnapshot(incoming)
    expect(counts.added).toBe(3)

    const rows = await db.outbox.toArray()
    const keys = rows.map((r) => r.key).sort()
    expect(keys).toEqual(
      [
        manifestKey('dialogue', 'new-d1'),
        manifestKey('annotation', 'new-a1'),
        'settings:all',
      ].sort(),
    )
    // The pre-existing local dialogue was not touched by the import, so it
    // must not appear in the outbox as a side effect of this import.
    expect(rows.some((r) => r.id === untouched.id)).toBe(false)
  })

  it('does not enqueue a settings row when nothing about settings changed', async () => {
    await db.settings.put({
      key: 'theme',
      value: 'dark',
      updatedAt: '2026-02-01T00:00:00.000Z',
    })
    await db.outbox.clear()

    const incoming = v1Snapshot({
      schemaVersion: DB_SCHEMA_VERSION,
      settings: [
        { key: 'theme', value: 'dark', updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
    })

    await importSnapshot(incoming)
    const rows = await db.outbox.toArray()
    expect(rows.some((r) => r.kind === 'settings')).toBe(false)
  })

  it('skips (does not re-enqueue) a record where the older incoming record loses', async () => {
    const local = await createDialogue('Local, newer')
    await db.outbox.clear()

    const incoming = v1Snapshot({
      schemaVersion: DB_SCHEMA_VERSION,
      dialogues: [
        makeDialogue({
          id: local.id,
          updatedAt: '2000-01-01T00:00:00.000Z',
          title: 'Stale incoming',
        }),
      ],
    })

    const counts = await importSnapshot(incoming)
    expect(counts.skipped).toBe(1)
    expect(await db.outbox.toArray()).toHaveLength(0)
  })
})
