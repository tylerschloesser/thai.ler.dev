import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import type { Dialogue } from '../src/db/db'
import { DB_SCHEMA_VERSION } from '../src/db/db'
import type { Snapshot } from '../src/db/snapshot'
import { SNAPSHOT_FORMAT } from '../src/db/snapshot'

// PLAN.MD §4.8 `sync`: two browser contexts sharing one server-side
// namespace (`.claude/rules/testing.md`'s `thai_ns` cookie) see each
// other's writes through the Blob-backed sync layer (`src/sync/**`), not
// just through IndexedDB - `seed`/`push`/`pull` are called explicitly
// throughout instead of waiting on the 500ms push debounce or the real
// visibilitychange/online listeners (`.claude/rules/testing.md`).

interface DebugWindow {
  __thai: {
    sync: { pull: () => Promise<unknown>; push: () => Promise<unknown> }
    exportSnapshot: () => Promise<Snapshot>
  }
}

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
    deviceId: 'e2e-sync-spec',
    dialogues,
    annotations: [],
    settings: [],
  }
}

function pull(page: Page): Promise<unknown> {
  return page.evaluate(() =>
    (window as unknown as DebugWindow).__thai.sync.pull(),
  )
}

function push(page: Page): Promise<unknown> {
  return page.evaluate(() =>
    (window as unknown as DebugWindow).__thai.sync.push(),
  )
}

function getExport(page: Page): Promise<Snapshot> {
  return page.evaluate(() =>
    (window as unknown as DebugWindow).__thai.exportSnapshot(),
  )
}

/** Strips the two fields that legitimately differ between two devices/exports. */
function withoutVolatile(
  snapshot: Snapshot,
): Omit<Snapshot, 'exportedAt' | 'deviceId'> {
  const rest: Partial<Snapshot> = { ...snapshot }
  delete rest.exportedAt
  delete rest.deviceId
  return rest as Omit<Snapshot, 'exportedAt' | 'deviceId'>
}

test.describe('sync', () => {
  test('a rename and a delete from one context reach a second context in the same namespace', async ({
    page,
    seed,
    newContextSameNs,
  }) => {
    const dialogueId = 'e2e-sync-dialogue'
    const dialogue = makeDialogue({
      id: dialogueId,
      title: 'Ordering coffee',
      sourceText: 'พนักงาน: สวัสดีค่ะ\nลูกค้า: สวัสดีครับ',
    })

    // --- Context A: create + rename --------------------------------------
    await page.goto('/')
    await seed(makeSnapshot([dialogue]))
    await expect(
      page.getByRole('link', { name: 'Ordering coffee' }),
    ).toBeVisible()

    const rowA = page
      .getByRole('listitem')
      .filter({ hasText: 'Ordering coffee' })
    await rowA.getByRole('button', { name: 'Rename' }).click()
    const renameDialog = page.getByRole('dialog', { name: 'Rename dialogue' })
    await renameDialog.getByRole('textbox').fill('Coffee shop chat')
    await renameDialog.getByRole('button', { name: 'Save' }).click()
    await expect(renameDialog).not.toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Coffee shop chat' }),
    ).toBeVisible()
    await push(page)

    // --- Context B: same namespace, sees the dialogue + its new title ----
    const contextB = await newContextSameNs()
    const pageB = await contextB.newPage()
    await pageB.goto('/')
    await pull(pageB)
    await expect(
      pageB.getByRole('link', { name: 'Coffee shop chat' }),
    ).toBeVisible()
    await expect(
      pageB.getByRole('link', { name: 'Ordering coffee' }),
    ).toHaveCount(0)

    // --- Context B deletes it ---------------------------------------------
    const rowB = pageB
      .getByRole('listitem')
      .filter({ hasText: 'Coffee shop chat' })
    await rowB.getByRole('button', { name: 'Delete' }).click()
    const confirmDialog = pageB.getByRole('alertdialog', {
      name: 'Delete this dialogue?',
    })
    await confirmDialog.getByRole('button', { name: 'Delete' }).click()
    await expect(confirmDialog).not.toBeVisible()
    await push(pageB)

    // --- Context A regains focus (a pull) and sees the delete -------------
    await pull(page)
    await expect(
      page.getByRole('link', { name: 'Coffee shop chat' }),
    ).toHaveCount(0)

    // --- Both sides agree on the record set (ignoring volatile fields) ----
    const exportA = withoutVolatile(await getExport(page))
    const exportB = withoutVolatile(await getExport(pageB))
    expect(exportA).toEqual(exportB)
  })
})
