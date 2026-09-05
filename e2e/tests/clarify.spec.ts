import { createExample, expect, test } from '../fixtures.ts'

test('asking about a selected segment gets an answer', async ({ page }) => {
  await page.goto('/')
  await createExample(page)

  await page.getByRole('link', { name: /^Open translation:/ }).click()
  await expect(page.locator('[data-status]')).toHaveCount(0)

  const firstSegment = page.locator('button[aria-pressed]').first()
  await firstSegment.click()
  await expect(firstSegment).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('textbox', { name: 'Your question' }).fill('Why this word?')
  await page.getByRole('button', { name: 'Ask' }).click()

  await expect(page.getByText('Thinking…')).toBeVisible()
  await expect(page.getByText('[fake] You asked')).toBeVisible()
})
