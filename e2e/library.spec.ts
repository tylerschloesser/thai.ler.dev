import { expect, test } from './fixtures'
import type { Dialogue } from '../src/db/db'
import { DB_SCHEMA_VERSION } from '../src/db/db'
import type { Snapshot } from '../src/db/snapshot'
import { SNAPSHOT_FORMAT } from '../src/db/snapshot'

function makeDialogue(input: {
  id: string
  title: string
  sourceText: string
}): Dialogue {
  const now = new Date().toISOString()
  return {
    id: input.id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    title: input.title,
    sourceText: input.sourceText,
    currentAnnotationId: null,
  }
}

function makeSnapshot(dialogues: Dialogue[]): Snapshot {
  return {
    format: SNAPSHOT_FORMAT,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    deviceId: 'e2e-library-spec',
    dialogues,
    annotations: [],
    settings: [],
  }
}

test.describe('library', () => {
  test('seed 2 dialogues, rename one, delete the other', async ({
    page,
    seed,
  }) => {
    const dialogueA = makeDialogue({
      id: 'e2e-dialogue-a',
      title: 'Ordering coffee',
      sourceText: 'พนักงาน: สวัสดีค่ะ\nลูกค้า: สวัสดีครับ',
    })
    const dialogueB = makeDialogue({
      id: 'e2e-dialogue-b',
      title: 'At the market',
      sourceText: 'คนขาย: เอาอะไรดีคะ\nลูกค้า: ขอกล้วยหนึ่งหวีครับ',
    })

    await page.goto('/')
    await seed(makeSnapshot([dialogueA, dialogueB]))

    await expect(
      page.getByRole('link', { name: 'Ordering coffee' }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'At the market' }),
    ).toBeVisible()

    // --- Rename "Ordering coffee" -----------------------------------
    const rowA = page
      .getByRole('listitem')
      .filter({ hasText: 'Ordering coffee' })
    await rowA.getByRole('button', { name: 'Rename' }).click()

    const renameDialog = page.getByRole('dialog', { name: 'Rename dialogue' })
    await expect(renameDialog).toBeVisible()
    await renameDialog.getByRole('textbox').fill('Coffee shop chat')
    await renameDialog.getByRole('button', { name: 'Save' }).click()
    await expect(renameDialog).not.toBeVisible()

    await expect(
      page.getByRole('link', { name: 'Coffee shop chat' }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Ordering coffee' }),
    ).toHaveCount(0)

    await page.reload()
    await expect(
      page.getByRole('link', { name: 'Coffee shop chat' }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Ordering coffee' }),
    ).toHaveCount(0)

    // --- Delete "At the market" --------------------------------------
    const rowB = page.getByRole('listitem').filter({ hasText: 'At the market' })
    await rowB.getByRole('button', { name: 'Delete' }).click()

    const confirmDialog = page.getByRole('alertdialog', {
      name: 'Delete this dialogue?',
    })
    await expect(confirmDialog).toBeVisible()
    await confirmDialog.getByRole('button', { name: 'Delete' }).click()
    await expect(confirmDialog).not.toBeVisible()
    await expect(page.getByRole('link', { name: 'At the market' })).toHaveCount(
      0,
    )

    await page.reload()
    await expect(page.getByRole('link', { name: 'At the market' })).toHaveCount(
      0,
    )
    await expect(
      page.getByRole('link', { name: 'Coffee shop chat' }),
    ).toBeVisible()
  })

  test('empty state renders when there are no dialogues', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('No dialogues yet')).toBeVisible()
  })
})
