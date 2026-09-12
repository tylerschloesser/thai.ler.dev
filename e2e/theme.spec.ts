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
  // Dialog/Select demos on `/`, which M4 removes (docs/plans/P0.md §5 M1/M4). The
  // Dialog case is repointed at the real Rename dialog (src/features/
  // dialogues/DialogueList.tsx), which is the same Dialog/Escape behavior
  // against production markup instead of a demo - an equally strong (if
  // not stronger) check. The Select case is now repointed at the real
  // Model select on `/settings` (src/features/settings/SettingsForm.tsx).
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

  test('select opens with the keyboard, navigates, and commits with Enter', async ({
    page,
  }) => {
    await page.goto('/settings')

    const trigger = page.getByRole('combobox', { name: 'Model' })
    await expect(trigger).toHaveText('Claude Opus 5')

    await trigger.focus()
    await page.keyboard.press('ArrowDown')
    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()

    // The popup has an entrance transition (Select.module.css) and Base UI
    // only wires up keyboard highlight-tracking once it's fully mounted -
    // wait for the currently-selected option to actually be highlighted
    // before sending more key presses, rather than racing that transition
    // with a blind ArrowDown (this was the source of real flakiness).
    const opusOption = page.getByRole('option', { name: 'Claude Opus 5' })
    const sonnetOption = page.getByRole('option', { name: 'Claude Sonnet 5' })
    await expect(opusOption).toHaveAttribute('data-highlighted', '')

    await page.keyboard.press('ArrowDown')
    await expect(sonnetOption).toHaveAttribute('data-highlighted', '')

    await page.keyboard.press('Enter')
    await expect(listbox).not.toBeVisible()
    await expect(trigger).toHaveText('Claude Sonnet 5')

    // Persisted, not just a visual change - reload and re-check. `setSetting`
    // (src/db/settings.ts) writes to IndexedDB asynchronously, so wait for
    // it to actually land before reloading (otherwise the reload can race
    // the write and this becomes flaky).
    // NB: expect.poll + page.evaluate, never page.waitForFunction with an
    // async predicate - that resolves on the returned Promise being truthy,
    // so it always "passes" after one poll and waits for nothing.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const win = window as unknown as {
            __thai: {
              db: {
                settings: {
                  get(key: string): Promise<{ value: unknown } | undefined>
                }
              }
            }
          }
          const row = await win.__thai.db.settings.get('model')
          return row?.value ?? null
        }),
      )
      .toBe('claude-sonnet-5')

    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Model' })).toHaveText(
      'Claude Sonnet 5',
    )
  })
})
