import { test as base, expect } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'

// M3 (PLAN.MD §4.8/§10): annotation runs server-side now, so e2e no longer
// mocks `api.anthropic.com` with a fixture-backed SSE response - the fake
// provider (`api/_lib/providers/fake.ts`) plays that role, selected via the
// `thai_model=fake` cookie every test carries. The route below becomes a
// guard instead of a mock: any *browser* request to `api.anthropic.com`
// during a test is a bug (hard rule 2) and fails the test immediately.
//
// Every context also carries a `thai_ns` cookie scoping it to its own
// namespace on the server (`api/_lib/context.ts`), so tests never see each
// other's dialogues/annotations - `DELETE /api/test/namespace?ns=` tears it
// down afterwards via that same context's `request` (which shares its
// cookie jar, unlike the top-level `request` fixture).

const MAX_NS_LENGTH = 40

function sanitizeNs(testId: string): string {
  const cleaned = testId.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return `e2e-${cleaned}`.slice(0, MAX_NS_LENGTH)
}

function hostnameOf(baseURL: string): string {
  return new URL(baseURL).hostname
}

async function installAnthropicGuard(context: BrowserContext): Promise<void> {
  await context.route('https://api.anthropic.com/**', async (route) => {
    await route.abort('failed')
    throw new Error(
      'Unexpected browser request to the real Anthropic API during an ' +
        `e2e test: ${route.request().method()} ${route.request().url()}. ` +
        'Annotation runs server-side as of M3 - the browser must never ' +
        'call api.anthropic.com directly.',
    )
  })
}

async function addBaseCookies(
  context: BrowserContext,
  baseURL: string,
  ns: string,
): Promise<void> {
  const domain = hostnameOf(baseURL)
  await context.addCookies([
    { name: 'thai_ns', value: ns, domain, path: '/' },
    { name: 'thai_model', value: 'fake', domain, path: '/' },
  ])
}

async function setOrClearCookie(
  context: BrowserContext,
  baseURL: string,
  name: string,
  value: string | null,
): Promise<void> {
  const domain = hostnameOf(baseURL)
  if (value === null) {
    await context.clearCookies({ name, domain })
    return
  }
  await context.addCookies([{ name, value, domain, path: '/' }])
}

interface Fixtures {
  /**
   * Seeds the app's IndexedDB state via `window.__thai.importSnapshot`
   * (added in M2), then pushes it to the server (`window.__thai.sync.push`,
   * added in M2) so server-dependent assertions (e.g. `library`'s rename/
   * delete-reached-the-server checks) see it too.
   */
  seed: (snapshot: unknown) => Promise<void>

  /**
   * Writes server-owned test fixtures directly via `POST /api/test/seed`
   * (`ALLOW_TEST_MODE` only) - for state that only makes sense as already
   * existing remotely (a stalled job, a record with no local copy yet).
   * Goes through `context.request` (not the top-level `request` fixture) so
   * it carries the same `thai_ns` cookie as the browser context.
   */
  seedServer: (snapshot: unknown) => Promise<void>

  /** Sets (or, given `null`, clears) the `thai_fake_error` cookie: the fake provider fails every line with that `AnnotateErrorKind` while set. */
  fakeError: (kind: string | null) => Promise<void>

  /** Sets (or clears) the `thai_fake_delay_ms` cookie: the fake provider's per-line delay. */
  fakeDelay: (ms: number | null) => Promise<void>

  /** Sets (or clears) the `thai_step_budget_ms` cookie: caps the runner's per-step budget, forcing hops. */
  stepBudget: (ms: number | null) => Promise<void>

  /**
   * Opens a second, independent `BrowserContext` carrying the same
   * `thai_ns`/`thai_model` cookies (and the same Anthropic guard) as this
   * test's primary context - simulating "a different browser" pulling from
   * the same server-side namespace. Torn down (closed) automatically; the
   * *namespace* is only ever deleted once, by the primary `context`
   * fixture's teardown.
   */
  newContextSameNs: () => Promise<BrowserContext>
}

// Note: Playwright's fixture callback is conventionally named `use`, but that
// collides with oxlint's react-hooks(rules-of-hooks) check (it treats any
// call to a function literally named `use` as React's `use()` hook). Renamed
// to `provide` here to avoid the false positive; it is the same Playwright
// fixture parameter, just relabeled.
export const test = base.extend<Fixtures>({
  context: async ({ context, baseURL }, provide, testInfo) => {
    const ns = sanitizeNs(testInfo.testId)
    await addBaseCookies(context, baseURL!, ns)
    await installAnthropicGuard(context)

    await provide(context)

    await context.request.delete(
      `/api/test/namespace?ns=${encodeURIComponent(ns)}`,
    )
  },

  seed: async ({ page }, provide) => {
    await provide(async (snapshot: unknown) => {
      await page.evaluate(async (snap) => {
        const win = window as unknown as {
          __thai?: {
            importSnapshot?: (s: unknown) => Promise<unknown>
            sync?: { push?: () => Promise<unknown> }
          }
        }
        if (!win.__thai?.importSnapshot) {
          throw new Error(
            'window.__thai.importSnapshot is not available yet (it is added in M2). ' +
              'The `seed` fixture cannot be used until the data layer lands.',
          )
        }
        await win.__thai.importSnapshot(snap)
        await win.__thai.sync?.push?.()
      }, snapshot)
    })
  },

  seedServer: async ({ context }, provide) => {
    await provide(async (snapshot: unknown) => {
      const res = await context.request.post('/api/test/seed', {
        data: snapshot,
      })
      if (!res.ok()) {
        throw new Error(
          `seedServer: POST /api/test/seed failed with ${res.status()}: ${await res.text()}`,
        )
      }
    })
  },

  fakeError: async ({ context, baseURL }, provide) => {
    await provide(async (kind: string | null) => {
      await setOrClearCookie(context, baseURL!, 'thai_fake_error', kind)
    })
  },

  fakeDelay: async ({ context, baseURL }, provide) => {
    await provide(async (ms: number | null) => {
      await setOrClearCookie(
        context,
        baseURL!,
        'thai_fake_delay_ms',
        ms === null ? null : String(ms),
      )
    })
  },

  stepBudget: async ({ context, baseURL }, provide) => {
    await provide(async (ms: number | null) => {
      await setOrClearCookie(
        context,
        baseURL!,
        'thai_step_budget_ms',
        ms === null ? null : String(ms),
      )
    })
  },

  newContextSameNs: async ({ browser, baseURL }, provide, testInfo) => {
    const ns = sanitizeNs(testInfo.testId)
    const opened: BrowserContext[] = []

    await provide(async () => {
      const extra = await browser.newContext()
      await addBaseCookies(extra, baseURL!, ns)
      await installAnthropicGuard(extra)
      opened.push(extra)
      return extra
    })

    for (const extra of opened) await extra.close()
  },
})

export { expect }
