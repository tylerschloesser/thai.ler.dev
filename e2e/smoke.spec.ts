import { expect, test } from './fixtures'

test.describe('smoke', () => {
  test('home renders and nav to Settings and back works', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'thai.ler.dev', level: 1 }),
    ).toBeVisible()

    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(
      page.getByRole('heading', { name: 'Settings', level: 1 }),
    ).toBeVisible()

    await page.getByRole('link', { name: 'Library' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(
      page.getByRole('heading', { name: 'thai.ler.dev', level: 1 }),
    ).toBeVisible()
  })
})
