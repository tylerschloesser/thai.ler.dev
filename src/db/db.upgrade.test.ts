import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { db } from './db'
import { LEGACY_RUN } from '../lib/records'

// Simulates a real device upgrade: a v1-shaped database (no `run` on
// annotations, no `outbox` table) already exists under the same IndexedDB
// database name when the v2-aware `ThaiLerDb` (imported as `db` above,
// already constructed with both `.version(1)` and `.version(2)` schema
// blocks) is first used. Dexie runs the `.version(2).upgrade()` callback
// from `src/db/db.ts` the first time `db` actually opens the connection —
// exercised below by touching `db.annotations` only after the v1 database
// is populated and closed.

const V1_STORES = {
  dialogues: 'id, updatedAt, deletedAt',
  annotations: 'id, dialogueId, updatedAt',
  settings: 'key',
  meta: 'key',
}

async function seedV1Database(): Promise<void> {
  const v1 = new Dexie('thai.ler.dev')
  v1.version(1).stores(V1_STORES)
  await v1.open()

  const now = '2026-01-01T00:00:00.000Z'
  await v1.table('dialogues').add({
    id: 'd1',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    title: 'Old dialogue',
    sourceText: 'Hello',
    currentAnnotationId: null,
  })
  // No `run` field at all — this is exactly what every pre-M1 annotation
  // record looked like.
  await v1.table('annotations').add({
    id: 'a1',
    createdAt: now,
    updatedAt: now,
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
  })

  v1.close()
}

describe('Dexie v1 -> v2 upgrade', () => {
  it('stamps LEGACY_RUN onto existing annotations and adds the outbox table', async () => {
    await seedV1Database()

    // First touch of the module-level `db` (already declared with both
    // version blocks) triggers Dexie's open + upgrade sequence.
    const annotation = await db.annotations.get('a1')
    expect(annotation).toBeDefined()
    expect(annotation?.run).toEqual(LEGACY_RUN)

    const dialogue = await db.dialogues.get('d1')
    expect(dialogue?.title).toBe('Old dialogue')

    // The outbox table exists and starts empty — the upgrade itself must
    // never enqueue anything (that's `startSync`'s first-run job, M2 §4.5).
    await expect(db.outbox.count()).resolves.toBe(0)
  })
})
