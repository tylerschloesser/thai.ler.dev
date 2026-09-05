import { createExample, expect, expectIndicator, test } from '../fixtures.ts'

test('a fresh example goes from an empty list to a finished breakdown', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Nothing yet. Paste some Thai above to get started.')).toBeVisible()

  await createExample(page)

  // Optimistic: the row is on screen before the model has done anything.
  const card = page.getByRole('link', { name: /^Open translation:/ })
  await expect(card.locator('[data-status="pending"]')).toBeVisible()

  await card.click()
  await expect(page.getByText('Breaking it down. This keeps going if you close the tab.')).toBeVisible()

  // Ready has no pill at all, so the absence of `[data-status]` anywhere on
  // the page is the actual "it's done" signal, not a status of "Ready".
  await expect(page.locator('[data-status]')).toHaveCount(0)

  await expect(page.locator('article ol > li')).toHaveCount(3)
  await expect
    .poll(() => page.locator('button[aria-pressed]').count())
    .toBeGreaterThanOrEqual(3)
  await expect(page.getByText('Fake breakdown of 3 line(s).')).toBeVisible()

  await expectIndicator(page, 'Synced')
})
