import { test as base, expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { anthropicMockRoute } from './mocks/anthropic'
import { DB_SCHEMA_VERSION } from '../src/db/db'
import { SNAPSHOT_FORMAT } from '../src/db/snapshot'
import type { Snapshot } from '../src/db/snapshot'

interface AnthropicErrorOverride {
  status: number
  body: unknown
  /** Requests left before automatically reverting to the default mock. */
  remaining: number
}

export interface MockAnthropicErrorOptions {
  status: number
  /** Defaults to a minimal Anthropic-shaped error body for `status`. */
  body?: unknown
  /** How many subsequent requests should fail this way. Default: every request until the test ends. */
  times?: number
}

// Per-page mutable override state, set by the `mockAnthropicError` fixture
// and read by the route handler installed on the `page` fixture below. A
// WeakMap (rather than closure state returned from one fixture into
// another) because Playwright fixtures don't compose that way - each
// fixture only sees the base `page`, not fixtures that depend on it.
const overrides = new WeakMap<Page, AnthropicErrorOverride | null>()

function defaultErrorBody(status: number): unknown {
  const type = status === 429 ? 'rate_limit_error' : 'api_error'
  return {
    type: 'error',
    error: { type, message: `Mocked ${status} response from e2e/fixtures.ts` },
  }
}

/**
 * Installs the default Anthropic mock on `page`: every request to
 * `https://api.anthropic.com/v1/messages` is served the fixture-backed SSE
 * mock (`anthropicMockRoute`, `.claude/rules/testing.md`), unless a test
 * has called the `mockAnthropicError` fixture, in which case the next
 * `times` request(s) get that error response instead. Any request to a
 * different `api.anthropic.com` path - or a real, unmocked network hit -
 * throws, which fails the test rather than passing silently.
 */
async function installAnthropicMock(page: Page): Promise<void> {
  overrides.set(page, null)

  await page.route('https://api.anthropic.com/**', async (route: Route) => {
    const url = route.request().url()
    if (!url.startsWith('https://api.anthropic.com/v1/messages')) {
      throw new Error(
        `Unexpected request to the real Anthropic API during an e2e test: ` +
          `${route.request().method()} ${url}. Tests must never hit the ` +
          'real API - only /v1/messages is mocked.',
      )
    }

    const override = overrides.get(page)
    if (override && override.remaining > 0) {
      override.remaining -= 1
      if (override.remaining === 0) overrides.set(page, null)
      await route.fulfill({
        status: override.status,
        contentType: 'application/json',
        body: JSON.stringify(override.body),
      })
      return
    }

    await anthropicMockRoute(route)
  })
}

interface Fixtures {
  /**
   * Seeds the app's IndexedDB state via window.__thai.importSnapshot, which
   * is exposed by the debug hook added in M2. Throws a clear error if that
   * hook isn't available yet, rather than failing typecheck.
   */
  seed: (snapshot: unknown) => Promise<void>

  /**
   * Extension point for error-injection specs (e.g. a future
   * `errors.spec.ts`): makes the next `times` (default: unlimited, for the
   * rest of the test) request(s) to the Anthropic mock fail with `status`/
   * `body` instead of the default fixture SSE response. Call it *before*
   * triggering the request (e.g. before clicking "Annotate" or "Retry
   * failed"). Errors are returned as plain JSON with that HTTP status -
   * exactly how the real API reports a failure - so `src/llm/annotateLine.ts`'s
   * error mapping (`AnnotateError` kinds: rate_limited, bad_request, ...)
   * sees the same shape it would from the real SDK.
   *
   * Example:
   *   await mockAnthropicError({ status: 429 })
   *   await page.getByRole('button', { name: 'Retry failed' }).click()
   *   // ... assert a toast + the line is marked failed again ...
   *   // (a later call, or none, reverts to the default mock)
   */
  mockAnthropicError: (options: MockAnthropicErrorOptions) => Promise<void>

  /**
   * Seeds a dummy Settings API-key override (`apiKeyOverride`, a plain
   * non-`sk-ant-` string) via `seed`, so the P0 browser-side Anthropic
   * client (`src/llm/client.ts`) has *a* key to construct itself with -
   * without it, `createAnthropicClient` throws `MissingApiKeyError` before
   * ever reaching the network, since this environment has no build-time
   * `ANTHROPIC_API_KEY`. The dummy value never leaves the browser: every
   * request to `https://api.anthropic.com/v1/messages` is intercepted by
   * the mock installed above regardless of which key the SDK signed the
   * request with. Call it after `page.goto` (like `seed`) and before
   * triggering an annotation. Removed in M3 along with the client-side key
   * path (the backend will hold the real key instead).
   */
  seedApiKey: () => Promise<void>
}

// Note: Playwright's fixture callback is conventionally named `use`, but that
// collides with oxlint's react-hooks(rules-of-hooks) check (it treats any
// call to a function literally named `use` as React's `use()` hook). Renamed
// to `provide` here to avoid the false positive; it is the same Playwright
// fixture parameter, just relabeled.
export const test = base.extend<Fixtures>({
  page: async ({ page }, provide) => {
    await installAnthropicMock(page)
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

  mockAnthropicError: async ({ page }, provide) => {
    await provide(async (options: MockAnthropicErrorOptions) => {
      overrides.set(page, {
        status: options.status,
        body: options.body ?? defaultErrorBody(options.status),
        remaining: options.times ?? Infinity,
      })
    })
  },

  seedApiKey: async ({ seed }, provide) => {
    await provide(async () => {
      const now = new Date().toISOString()
      const snapshot: Snapshot = {
        format: SNAPSHOT_FORMAT,
        schemaVersion: DB_SCHEMA_VERSION,
        exportedAt: now,
        deviceId: 'e2e-fixtures-seed-api-key',
        dialogues: [],
        annotations: [],
        settings: [
          { key: 'apiKeyOverride', value: 'e2e-dummy-key', updatedAt: now },
        ],
      }
      await seed(snapshot)
    })
  },
})

export { expect }
