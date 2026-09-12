import { expect, test } from './fixtures'

test.describe('annotate', () => {
  test('paste the sample dialogue, click Annotate, and land on the rendered dialogue', async ({
    page,
    seedApiKey,
  }) => {
    await page.goto('/')
    await seedApiKey()

    await page.getByRole('button', { name: 'Load sample' }).click()
    await page.getByRole('button', { name: 'Annotate' }).click()

    await expect(page).toHaveURL(/\/d\/[^/]+$/)

    // Every line of the 8-line sample dialogue renders as its own list item.
    await expect(page.getByRole('listitem')).toHaveCount(8)

    // Status reaches complete (AnnotateStatus's "N/M lines" progress).
    await expect(page.getByText('8/8 lines')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Retry failed' }),
    ).toHaveCount(0)

    // Romanization and gloss render underneath the first word chip, per the
    // display toggles' defaults (src/db/settings.ts SETTINGS_DEFAULTS).
    await expect(page.getByText('sà-wàt-dii')).toBeVisible()
    await expect(page.getByText('hello / greetings')).toBeVisible()
  })
})
