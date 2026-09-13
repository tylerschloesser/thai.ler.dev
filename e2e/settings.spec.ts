import { expect, test } from './fixtures'
import type { Dialogue } from '../src/db/db'
import { DB_SCHEMA_VERSION } from '../src/db/db'
import type { Snapshot } from '../src/db/snapshot'
import { SNAPSHOT_FORMAT } from '../src/db/snapshot'

function makeDialogue(id: string, title: string): Dialogue {
  const now = new Date().toISOString()
  return {
    id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    title,
    sourceText: 'พนักงาน: สวัสดีค่ะ\nลูกค้า: สวัสดีครับ',
    currentAnnotationId: null,
  }
}

function makeSnapshot(dialogues: Dialogue[]): Snapshot {
  return {
    format: SNAPSHOT_FORMAT,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    deviceId: 'e2e-settings-spec',
    dialogues,
    annotations: [],
    settings: [],
  }
}

interface DebugWindow {
  __thai: {
    db: {
      settings: { get(key: string): Promise<{ value: unknown } | undefined> }
    }
  }
}

/**
 * `setSetting` (src/db/settings.ts) writes to Dexie asynchronously - the UI
 * updates optimistically before that write lands. Reloading the page right
 * after a click can race the write, so wait for it to actually land in
 * IndexedDB (via the same window.__thai.db debug hook `seed` uses) before
 * asserting persistence across a reload.
 */
async function waitForPersistedSetting(
  page: import('@playwright/test').Page,
  key: string,
  value: unknown,
): Promise<void> {
  // NB: expect.poll + page.evaluate, never page.waitForFunction with an async
  // predicate - the latter resolves on the returned Promise being truthy, so
  // it always "passes" after one poll and waits for nothing.
  await expect
    .poll(() =>
      page.evaluate(async (k) => {
        const win = window as unknown as DebugWindow
        const row = await win.__thai.db.settings.get(k)
        return row?.value ?? null
      }, key),
    )
    .toBe(value)
}

test.describe('settings', () => {
  test('changing the model persists across a reload', async ({ page }) => {
    await page.goto('/settings')

    const trigger = page.getByRole('combobox', { name: 'Model' })
    await expect(trigger).toHaveText('Claude Opus 5')

    await trigger.click()
    await page.getByRole('option', { name: 'Claude Sonnet 5' }).click()
    await expect(trigger).toHaveText('Claude Sonnet 5')
    await waitForPersistedSetting(page, 'model', 'claude-sonnet-5')

    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Model' })).toHaveText(
      'Claude Sonnet 5',
    )
  })

  test('toggling showRomanization persists across a reload', async ({
    page,
  }) => {
    await page.goto('/settings')

    const toggle = page.getByRole('button', { name: 'Show romanization' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await waitForPersistedSetting(page, 'showRomanization', false)

    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Show romanization' }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  test('Export downloads a valid snapshot of the current data', async ({
    page,
    seed,
  }) => {
    const dialogue = makeDialogue('e2e-settings-export', 'Ordering coffee')
    await page.goto('/settings')
    await seed(makeSnapshot([dialogue]))

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(
      /^thai-ler-dev-\d{4}-\d{2}-\d{2}\.json$/,
    )

    const path = await download.path()
    if (!path) throw new Error('Download did not save to disk.')
    const fs = await import('node:fs/promises')
    const contents = await fs.readFile(path, 'utf8')
    const snapshot = JSON.parse(contents) as Snapshot

    expect(snapshot.format).toBe(SNAPSHOT_FORMAT)
    expect(snapshot.schemaVersion).toBe(DB_SCHEMA_VERSION)
    expect(snapshot.dialogues.some((d) => d.id === dialogue.id)).toBe(true)
  })

  test('Import merges a snapshot and toasts the merge counts', async ({
    page,
  }, testInfo) => {
    await page.goto('/settings')

    const incoming = makeSnapshot([
      makeDialogue('e2e-settings-import', 'At the market'),
    ])
    const filePath = testInfo.outputPath('import-snapshot.json')
    const fs = await import('node:fs/promises')
    await fs.writeFile(filePath, JSON.stringify(incoming), 'utf8')

    await page.getByLabel('Import snapshot file').setInputFiles(filePath)

    await expect(page.getByText('Import complete')).toBeVisible()
    await expect(
      page.getByText('1 added, 0 updated, 0 unchanged.'),
    ).toBeVisible()
  })

  test('a changed model is sent as the model in POST /api/annotate', async ({
    page,
  }) => {
    await page.goto('/settings')

    const trigger = page.getByRole('combobox', { name: 'Model' })
    await trigger.click()
    await page.getByRole('option', { name: 'Claude Sonnet 5' }).click()
    await waitForPersistedSetting(page, 'model', 'claude-sonnet-5')

    await page.goto('/')
    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/annotate') && req.method() === 'POST',
    )
    await page.getByRole('button', { name: 'Load sample' }).click()
    await page.getByRole('button', { name: 'Annotate' }).click()
    const request = await requestPromise

    const body = request.postDataJSON() as { model: string }
    expect(body.model).toBe('claude-sonnet-5')
  })

  test('the Sync section shows a last-pull time and there is no API-key field', async ({
    page,
  }) => {
    await page.goto('/')
    await page.evaluate(() =>
      (
        window as unknown as {
          __thai: { sync: { pull: () => Promise<unknown> } }
        }
      ).__thai.sync.pull(),
    )

    await page.goto('/settings')

    const syncSection = page.getByRole('region', { name: 'Sync' })
    await expect(
      syncSection.getByRole('heading', { name: 'Sync' }),
    ).toBeVisible()
    await expect(syncSection.getByText('Last pull')).toBeVisible()
    // `{ exact: true }` matters here: a plain `getByText('Never')` also
    // case-insensitively substring-matches ExportImport's unrelated "is
    // never wiped" copy elsewhere on the page, which would make this
    // assertion pass or fail for the wrong reason regardless of the actual
    // sync state.
    await expect(syncSection.getByText('Never', { exact: true })).toHaveCount(0)
    await expect(
      syncSection.getByRole('button', { name: 'Sync now' }),
    ).toBeVisible()
    await expect(
      syncSection.getByRole('button', { name: 'Rebuild sync index' }),
    ).toBeVisible()

    await expect(page.getByLabel('API key override')).toHaveCount(0)
    await expect(page.getByText('No API key configured')).toHaveCount(0)
  })

  test('Import of a malformed file surfaces a readable error toast', async ({
    page,
  }, testInfo) => {
    await page.goto('/settings')

    const filePath = testInfo.outputPath('not-json.txt')
    const fs = await import('node:fs/promises')
    await fs.writeFile(filePath, 'this is not json', 'utf8')

    await page.getByLabel('Import snapshot file').setInputFiles(filePath)

    await expect(page.getByText('Import failed')).toBeVisible()
    await expect(page.getByText('not valid JSON')).toBeVisible()
  })
})
