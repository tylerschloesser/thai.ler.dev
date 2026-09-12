import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// TODO(M3): replace this default handler with a real SSE mock. It should read
// the request body via route.request().postDataJSON(), find the <target>
// line text, look up the matching line in src/fixtures/sample.annotation.json,
// and route.fulfill() with an SSE body built by e2e/mocks/anthropic.ts's
// sseFromText(). Until that lands, tests that need the Anthropic API must
// install their own page.route('https://api.anthropic.com/**', ...) override
// before triggering a request.
async function installAnthropicGuard(page: Page): Promise<void> {
  await page.route('https://api.anthropic.com/**', (route) => {
    throw new Error(
      `Unexpected request to the real Anthropic API during an e2e test: ` +
        `${route.request().method()} ${route.request().url()}. ` +
        'Tests must never hit the real API - install a mock route before triggering this request.',
    )
  })
}

interface Fixtures {
  /**
   * Seeds the app's IndexedDB state via window.__thai.importSnapshot, which
   * is exposed by the debug hook added in M2. Throws a clear error if that
   * hook isn't available yet, rather than failing typecheck.
   */
  seed: (snapshot: unknown) => Promise<void>
}

// Note: Playwright's fixture callback is conventionally named `use`, but that
// collides with oxlint's react-hooks(rules-of-hooks) check (it treats any
// call to a function literally named `use` as React's `use()` hook). Renamed
// to `provide` here to avoid the false positive; it is the same Playwright
// fixture parameter, just relabeled.
export const test = base.extend<Fixtures>({
  page: async ({ page }, provide) => {
    await installAnthropicGuard(page)
    await provide(page)
  },

  seed: async ({ page }, provide) => {
    await provide(async (snapshot: unknown) => {
      await page.evaluate(async (snap) => {
        const win = window as unknown as {
          __thai?: { importSnapshot?: (s: unknown) => Promise<unknown> }
        }
        if (!win.__thai?.importSnapshot) {
          throw new Error(
            'window.__thai.importSnapshot is not available yet (it is added in M2). ' +
              'The `seed` fixture cannot be used until the data layer lands.',
          )
        }
        await win.__thai.importSnapshot(snap)
      }, snapshot)
    })
  },
})

export { expect }
