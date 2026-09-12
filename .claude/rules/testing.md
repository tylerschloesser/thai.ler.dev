---
paths:
  - 'e2e/**'
  - '**/*.test.ts'
  - 'playwright.config.ts'
  - 'vitest.config.ts'
---

# Testing rules

`e2e/` (Playwright specs, `fixtures.ts`, `mocks/anthropic.ts`, `live/`)
plus `playwright.config.ts`/`vitest.config.ts` at the repo root. 11
Playwright spec files exist today (10 in the fast suite, 1 under
`e2e/live/`); see docs/plans/P0.md §4.6 for the P0 spec list and PLAN.MD
§4.8 for the P1 spec table (not all of it exists yet — M0 only adds
`api-health.spec.ts` and `live/health.spec.ts`).

## Mock contract (current, pre-M3)

The Anthropic call still runs in the browser today, so `e2e/fixtures.ts`
still installs a Playwright route on `https://api.anthropic.com/**`: any
request to `/v1/messages` is served the fixture-backed SSE mock
(`anthropicMockRoute` from `e2e/mocks/anthropic.ts`); any other
`api.anthropic.com` path, or an unmocked real hit, throws and fails the
test (hard rule 2). Because `vite.config.ts` dropped `envPrefix` in M0, the
P0 browser client has no build-time key, so `annotate`/`errors`/
`persistence` call the `seedApiKey` fixture (seeds a dummy, non-`sk-ant-`
`apiKeyOverride` setting via `seed`) before triggering an annotation — the
dummy value never leaves the browser since the route above intercepts
every request regardless of which key signed it. This whole mock + dummy
key path is temporary: M1 adds a server-side fake provider selected by the
`thai_model`/`thai_fake_error` cookies (`.claude/rules/api.md`), and M3
moves annotation server-side and deletes the browser client, the
`apiKeyOverride` setting, and `seedApiKey` along with it.

## Seeding

Seed state through `window.__thai.importSnapshot(snapshot)` via
`page.evaluate`, not by driving the UI to create fixture data. `window.__thai
= { db, importSnapshot, exportSnapshot }` is always present (not test-only)
so this hook must keep working as the app evolves. M1 adds a
`seedServer(snapshot)` fixture (`POST /api/test/seed`, `ALLOW_TEST_MODE`
only) for state that only exists server-side (stalled jobs, remote-only
records) — until then, `seed` covers everything.

## Playwright webServer env

The local fast suite's `webServer` runs `pnpm build && pnpm preview --port
4173 --strictPort` with `env: { BLOB_BACKEND: 'memory', MODEL_PROVIDER:
'fake', ALLOW_TEST_MODE: '1', STEP_BUDGET_MS: '250000' }` — the API layer
always runs the in-memory store and (once M1 lands) the fake provider
locally, never touching real Blob or Anthropic.

## `@live` tag and `e2e/live/`

Specs under `e2e/live/**/*.spec.ts` are tagged `{ tag: '@live' }` and run
only against a real Vercel preview. `playwright.config.ts` sets
`grepInvert: /@live/` whenever `PLAYWRIGHT_BASE_URL` is unset, so `pnpm
test:e2e` never attempts to reach a preview deployment; `pnpm
test:e2e:vercel` (`scripts/e2e-vercel.sh`) deploys a CLI preview, sets
`PLAYWRIGHT_BASE_URL`, and runs `playwright test --grep @live` instead —
the two tags are mutually exclusive by construction, not by convention.
Against a remote target, `retries: 1` (vs. `0` locally), timeouts are
longer, and `extraHTTPHeaders` adds `x-vercel-protection-bypass` /
`x-vercel-set-bypass-cookie` so requests pass Vercel Authentication.
`e2e/api-health.spec.ts` (fast) and `e2e/live/health.spec.ts` (`@live`)
both assert `GET /api/health`'s shape and that the M0 routing stubs
(`/api/annotation`, `/api/annotation/resume`) answer `501` and that
unknown `/api/*` is a JSON `404`, not the SPA's `index.html` — the live
version additionally asserts `blobBackend: 'vercel'` and records
`spike.hasDeadline` as a test annotation rather than asserting its value
(`getDeadline()`'s on-Vercel behavior is still being confirmed).
`E2E_REAL_MODEL=1` (a real-model smoke) is a P1/M4 addition, not yet
wired up.

## Vitest includes

`vitest.config.ts`'s `include` is `src/**/*.test.ts`, `e2e/**/*.test.ts`,
`api/**/*.test.ts`, `scripts/**/*.test.ts` — do not add a separate Vitest
config for `api/` or `scripts/`; they share the root config and its `node`
environment (with `vitest.setup.ts` polyfilling IndexedDB for Dexie).
`api/_lib/store/store.vercel.test.ts` is the one suite that talks to the
real Vercel Blob API: it's guarded with `describe.skipIf(!hasToken)` where
`hasToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN)`, uses a random
namespace prefix, and deletes everything it wrote in `afterAll` — never
remove that guard or that cleanup to "just run it," and never point it at
a shared/non-random prefix.

## Import-extension guard

A Vitest test at `scripts/import-extensions.test.ts` is being added to
enforce `.claude/rules/api.md`'s rule that every relative import inside
`api/**`, `src/lib/**`, and `src/llm/**` ends in `.js`. Once it lands,
treat a failure there the same as any other `pnpm test` failure — it's
catching a real Vercel runtime crash (`ERR_MODULE_NOT_FOUND`), not a style
nit.

## Never `waitForFunction` with an async predicate

`page.waitForFunction(async () => ...)` resolves as soon as the returned
**Promise** is seen as truthy, so it "passes" after a single poll no matter
what the predicate actually returns. It looks like a wait and is a no-op.
Three specs shipped with this and were silently asserting on mid-flight
state. Use `expect.poll()` with `page.evaluate()` instead - `evaluate`
awaits the promise and `poll` retries on the real value:

```ts
await expect
  .poll(() => page.evaluate(async () => (await read()).status))
  .toBe('complete')
```

## Prefer `test.fixme` over weakened assertions

If a spec can't be made to pass without loosening what it actually checks
(e.g. dropping an assertion, widening a selector until it's meaningless),
mark it `test.fixme('reason')` instead and leave a note — never weaken an
assertion just to turn a test green.

## Speed budget

Full local Playwright suite must stay under 60s wall-clock:
`fullyParallel: true`, Chromium only, one shared `webServer`, no
`waitForTimeout` polling loops. Shard if it creeps up as specs are added.
