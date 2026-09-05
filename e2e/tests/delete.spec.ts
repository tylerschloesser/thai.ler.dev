import { createExample, expect, expectIndicator, test } from '../fixtures.ts'

test('a deleted translation stays gone after a reload', async ({ page }) => {
  await page.goto('/')
  await createExample(page)

  await page.getByRole('link', { name: /^Open translation:/ }).click()
  await expect(page.locator('[data-status]')).toHaveCount(0)

  // Scoped to the detail header: `Delete` also appears on every
  // clarification card once one exists.
  await page.locator('article > header').getByRole('button', { name: 'Delete' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByText('Nothing yet. Paste some Thai above to get started.')).toBeVisible()

  // Wait for the outbox to actually confirm the delete with the server before
  // reloading — otherwise a reload can race the in-flight DELETE and read the
  // row back from a `GET /api/state` that landed before the server saw it.
  await expectIndicator(page, 'Synced')

  // The point of the test: a reload only reads from the server (and the
  // persisted cache it fills), so this only stays empty if the delete really
  // landed, not just the optimistic local state.
  await page.reload()
  await expect(page.getByText('Nothing yet. Paste some Thai above to get started.')).toBeVisible()
})
