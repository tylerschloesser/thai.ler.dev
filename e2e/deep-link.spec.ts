import { expect, test } from './fixtures'

test.describe('deep link', () => {
  test('direct navigation to /settings renders Settings', async ({ page }) => {
    await page.goto('/settings')
    await expect(
      page.getByRole('heading', { name: 'Settings', level: 1 }),
    ).toBeVisible()
  })

  test('direct navigation to an unknown dialogue id renders the placeholder page', async ({
    page,
  }) => {
    await page.goto('/d/does-not-exist')
    await expect(
      page.getByRole('heading', { name: 'Dialogue does-not-exist', level: 1 }),
    ).toBeVisible()
  })

  test('direct navigation to a totally unknown path renders Not found', async ({
    page,
  }) => {
    await page.goto('/totally/unknown/path')
    await expect(page.getByText('Not found')).toBeVisible()
  })
})
