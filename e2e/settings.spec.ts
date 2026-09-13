import { expect, test } from './fixtures'

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
    // case-insensitively substring-matches other unrelated copy elsewhere
    // on the page, which would make this assertion pass or fail for the
    // wrong reason regardless of the actual sync state.
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
})
