import { expect, test } from './fixtures'
import type { Dialogue } from '../src/db/db'
import { DB_SCHEMA_VERSION } from '../src/db/db'
import type { Snapshot } from '../src/db/snapshot'
import { SNAPSHOT_FORMAT } from '../src/db/snapshot'

function makeSeedSnapshot(dialogue: Dialogue): Snapshot {
  return {
    format: SNAPSHOT_FORMAT,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    deviceId: 'e2e-theme-spec',
    dialogues: [dialogue],
    annotations: [],
    settings: [],
  }
}

test.describe('theme', () => {
  test('toggling theme sets data-theme on <html> and persists across reload', async ({
    page,
  }) => {
    await page.goto('/')
    const html = page.locator('html')

    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await expect(html).toHaveAttribute('data-theme', 'dark')

    await page.reload()
    await expect(html).toHaveAttribute('data-theme', 'dark')

    await page.getByRole('button', { name: 'Light', exact: true }).click()
    await expect(html).toHaveAttribute('data-theme', 'light')
  })
})

test.describe('keyboard nav', () => {
  // These two cases originally drove the M1 kitchen sink's generic
  // Dialog/Select demos on `/`, which M4 removes (PLAN.MD §5 M1/M4). The
  // Dialog case is repointed at the real Rename dialog (src/features/
  // dialogues/DialogueList.tsx), which is the same Dialog/Escape behavior
  // against production markup instead of a demo - an equally strong (if
  // not stronger) check. The Select case has no home yet: the Model select
  // lives on `/settings`, owned by a different M4-wave agent and out of
  // scope here - left as `test.fixme` per .claude/rules/testing.md rather
  // than weakened.
  test('dialog opens and closes with Escape', async ({ page, seed }) => {
    const now = new Date().toISOString()
    await page.goto('/')
    await seed(
      makeSeedSnapshot({
        id: 'e2e-theme-dialog-target',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        title: 'Ordering coffee',
        sourceText: 'พนักงาน: สวัสดีค่ะ\nลูกค้า: สวัสดีครับ',
        currentAnnotationId: null,
      }),
    )

    const row = page
      .getByRole('listitem')
      .filter({ hasText: 'Ordering coffee' })
    await row.getByRole('button', { name: 'Rename' }).click()
    const dialog = page.getByRole('dialog', { name: 'Rename dialogue' })
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })

  test.fixme('select opens with the keyboard and Escape closes it', async () => {
    // The Model select lives on /settings (src/routes/settings.tsx),
    // owned by a different M4-wave agent and not yet built as of this
    // change - see the note above.
  })
})
