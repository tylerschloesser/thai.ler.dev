import { beforeEach, describe, expect, it } from 'vitest'
import { db, purgeTombstones } from './db'
import type { Dialogue, OutboxRow } from './db'
import { manifestKey } from '../lib/records'

beforeEach(async () => {
  await db.dialogues.clear()
  await db.annotations.clear()
  await db.outbox.clear()
})

function daysAgoIso(days: number, from: Date): string {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

function makeDialogue(id: string, deletedAt: string | null): Dialogue {
  const now = new Date().toISOString()
  return {
    id,
    createdAt: now,
    updatedAt: now,
    deletedAt,
    title: id,
    sourceText: 'x',
    currentAnnotationId: null,
  }
}

function makeOutboxRow(kind: 'dialogue' | 'annotation', id: string): OutboxRow {
  return {
    key: manifestKey(kind, id),
    kind,
    id,
    updatedAt: new Date().toISOString(),
    rev: `rev-${id}`,
  }
}

describe('purgeTombstones', () => {
  it('hard-deletes a 91-day-old tombstone but keeps an 89-day-old one and a live row', async () => {
    const now = new Date('2026-09-12T00:00:00.000Z')
    await db.dialogues.bulkAdd([
      makeDialogue('old', daysAgoIso(91, now)),
      makeDialogue('recent', daysAgoIso(89, now)),
      makeDialogue('alive', null),
    ])

    const removed = await purgeTombstones(now)
    expect(removed).toBe(1)

    const remainingIds = (await db.dialogues.toArray()).map((d) => d.id).sort()
    expect(remainingIds).toEqual(['alive', 'recent'])
  })

  it('is a no-op when there is nothing to purge', async () => {
    const now = new Date('2026-09-12T00:00:00.000Z')
    await db.dialogues.bulkAdd([makeDialogue('alive', null)])
    const removed = await purgeTombstones(now)
    expect(removed).toBe(0)
    expect(await db.dialogues.count()).toBe(1)
  })

  // PLAN.MD §5 M5: hard-purging a tombstone must also drop any outbox row
  // that pointed at it — otherwise `push()` would try to load a record
  // that no longer exists, forever. A row for a record that is merely
  // tombstoned (not yet past the 90-day cutoff) still needs to be pushed,
  // so it must survive.
  it('deletes the outbox row for a hard-purged dialogue tombstone', async () => {
    const now = new Date('2026-09-12T00:00:00.000Z')
    await db.dialogues.bulkAdd([makeDialogue('old', daysAgoIso(91, now))])
    await db.outbox.bulkAdd([makeOutboxRow('dialogue', 'old')])

    const removed = await purgeTombstones(now)
    expect(removed).toBe(1)
    expect(await db.outbox.get(manifestKey('dialogue', 'old'))).toBeUndefined()
  })

  it('keeps the outbox row for a tombstone that is not yet hard-purged', async () => {
    const now = new Date('2026-09-12T00:00:00.000Z')
    await db.dialogues.bulkAdd([makeDialogue('recent', daysAgoIso(89, now))])
    await db.outbox.bulkAdd([makeOutboxRow('dialogue', 'recent')])

    const removed = await purgeTombstones(now)
    expect(removed).toBe(0)
    expect(await db.outbox.get(manifestKey('dialogue', 'recent'))).toBeDefined()
  })

  it('leaves an unrelated outbox row (e.g. settings) untouched', async () => {
    const now = new Date('2026-09-12T00:00:00.000Z')
    await db.dialogues.bulkAdd([makeDialogue('old', daysAgoIso(91, now))])
    await db.outbox.bulkAdd([
      makeOutboxRow('dialogue', 'old'),
      {
        key: 'settings:all',
        kind: 'settings',
        id: 'all',
        updatedAt: now.toISOString(),
        rev: 'rev-settings',
      },
    ])

    await purgeTombstones(now)
    expect(await db.outbox.get('settings:all')).toBeDefined()
  })
})
