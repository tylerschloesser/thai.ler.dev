import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  createAnnotation,
  createDialogue,
  finalizeAnnotation,
  getAnnotation,
  getDialogue,
  listDialoguesAsync,
  renameDialogue,
  setCurrentAnnotation,
  softDeleteDialogue,
  upsertAnnotationLine,
} from './repo'
import type { LineAnnotation } from './db'

beforeEach(async () => {
  await db.dialogues.clear()
  await db.annotations.clear()
})

const sampleLine: LineAnnotation = {
  speaker: 'Somchai',
  thai: 'สวัสดีครับ',
  translation: 'Hello.',
  sentences: [],
  notes: [],
}

describe('dialogue round trip', () => {
  it('creates, lists, renames, soft-deletes, and excludes the deleted row from list', async () => {
    const created = await createDialogue('Somchai: สวัสดีครับ\nNok: สวัสดีค่ะ')
    expect(created.title).toBe('สวัสดีครับ')
    expect(created.deletedAt).toBeNull()

    const afterCreate = await listDialoguesAsync()
    expect(afterCreate.map((d) => d.id)).toContain(created.id)

    await renameDialogue(created.id, 'Greetings')
    const renamed = await getDialogue(created.id)
    expect(renamed?.title).toBe('Greetings')
    expect(renamed?.updatedAt).not.toBe(created.updatedAt)

    await softDeleteDialogue(created.id)
    const softDeleted = await getDialogue(created.id)
    expect(softDeleted?.deletedAt).not.toBeNull()

    const afterDelete = await listDialoguesAsync()
    expect(afterDelete.map((d) => d.id)).not.toContain(created.id)
  })

  it('falls back to Untitled for a blank dialogue', async () => {
    const created = await createDialogue('   \n   ')
    expect(created.title).toBe('Untitled')
  })

  it('caps an overlong title and trims a leading speaker prefix', async () => {
    const longLine = 'a'.repeat(200)
    const created = await createDialogue(`Speaker: ${longLine}`)
    expect(created.title.length).toBeLessThanOrEqual(81)
    expect(created.title.startsWith('Speaker:')).toBe(false)
  })
})

describe('annotation lifecycle', () => {
  it('upserts each line then finalizes to status complete', async () => {
    const dialogue = await createDialogue('Somchai: สวัสดีครับ\nNok: สวัสดีค่ะ')
    const annotation = await createAnnotation({
      dialogueId: dialogue.id,
      model: 'claude-opus-5',
      promptVersion: 1,
      lineCount: 2,
    })
    expect(annotation.status).toBe('partial')
    expect(annotation.lines).toEqual([null, null])

    await upsertAnnotationLine(annotation.id, 0, { line: sampleLine })
    await upsertAnnotationLine(annotation.id, 1, { error: 'boom' })

    const midway = await getAnnotation(annotation.id)
    expect(midway?.lines[0]).toEqual(sampleLine)
    expect(midway?.lineErrors[1]).toBe('boom')
    expect(midway?.status).toBe('partial')

    await finalizeAnnotation(annotation.id)
    const finalized = await getAnnotation(annotation.id)
    expect(finalized?.status).toBe('complete')

    await setCurrentAnnotation(dialogue.id, annotation.id)
    const updatedDialogue = await getDialogue(dialogue.id)
    expect(updatedDialogue?.currentAnnotationId).toBe(annotation.id)
  })
})
