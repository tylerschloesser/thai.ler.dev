import { expect, test } from '../fixtures.ts'

test('a failed row can be retried into a ready one', async ({ page }) => {
  await page.goto('/')

  // Source text containing FAIL trips the fake model's one-shot failure.
  await page.getByRole('textbox', { name: 'Thai text' }).fill('FAIL ทดสอบ')
  await page.getByRole('button', { name: 'Break it down' }).click()

  await page.getByRole('link', { name: /^Open translation:/ }).click()

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('fake model failure requested')

  // Scoped: `Try again` also lives outside any alert, and there's a second
  // alert-scoped one in the clarification panel — an unscoped locator here
  // would be strict-mode-flaky.
  await alert.getByRole('button', { name: 'Try again' }).click()

  await expect(page.locator('[data-status="pending"]')).toBeVisible()
  await expect(page.locator('[data-status]')).toHaveCount(0)

  // The fake model only fails a row once per process, so the retry lands on
  // the real breakdown of the two segments in the source line.
  await expect(page.getByText('FAIL', { exact: true })).toBeVisible()
  await expect(page.getByText('ทดสอบ', { exact: true })).toBeVisible()
})
