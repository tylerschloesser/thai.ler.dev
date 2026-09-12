import { expect, test } from './fixtures'

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
  test('dialog opens and closes with Escape', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Open dialog' }).click()
    const dialog = page.getByRole('dialog', { name: 'Rename dialogue' })
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })

  test('select opens with the keyboard and Escape closes it', async ({
    page,
  }) => {
    await page.goto('/')

    const trigger = page.getByRole('combobox', { name: 'Model' })
    await trigger.focus()
    await page.keyboard.press('Enter')

    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()
    await expect(
      page.getByRole('option', { name: 'Claude Opus' }),
    ).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(listbox).not.toBeVisible()
    await expect(trigger).toBeFocused()
  })
})
