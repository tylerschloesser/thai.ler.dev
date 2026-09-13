import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  createDialogue,
  getDialogue,
  listDialoguesAsync,
  renameDialogue,
  softDeleteDialogue,
} from './repo'

beforeEach(async () => {
  await db.dialogues.clear()
  await db.annotations.clear()
})

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
