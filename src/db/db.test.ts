import { beforeEach, describe, expect, it } from 'vitest'
import { db, purgeTombstones } from './db'
import type { Dialogue } from './db'

beforeEach(async () => {
  await db.dialogues.clear()
  await db.annotations.clear()
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
})
