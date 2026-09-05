import { expect, test as base, type Page } from '@playwright/test'

export { expect }

/**
 * Every request the browser makes — including the app's own `fetch` calls
 * through the preview proxy — carries `x-id-token`, and the local API
 * (`AUTH=header`) treats that header as the whole identity: a distinct token
 * is a distinct, empty data partition. Minting one per test is what makes
 * `fullyParallel` safe — a test can never see another test's rows.
 */
export const test = base.extend<{ userId: string }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies out of this pattern, so it has to stay, empty and all.
  userId: async ({}, use, testInfo) => {
    const id = `${testInfo.testId}-${Date.now()}`.replace(/[^A-Za-z0-9._-]/g, '-')
    await use(id)
  },
  extraHTTPHeaders: async ({ userId }, use) => {
    await use({ 'x-id-token': userId })
  },
})

export async function createExample(page: Page) {
  await page.getByRole('button', { name: 'Use an example' }).click()
  await page.getByRole('button', { name: 'Break it down' }).click()
}

export async function expectIndicator(page: Page, text: string, options?: { timeout?: number }) {
  // Not `getByRole('status')`: `<output>` maps to that role, but the
  // translation list renders a second `<output>` while a row is loading, so
  // the role alone doesn't pick out the header indicator.
  await expect(page.locator('output[data-tone]')).toHaveText(text, options)
}
