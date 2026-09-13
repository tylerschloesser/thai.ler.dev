---
paths:
  - 'e2e/**'
  - '**/*.test.ts'
  - 'playwright.config.ts'
  - 'vitest.config.ts'
---

# Testing rules

`e2e/` (Playwright specs, `fixtures.ts`, `mocks/anthropic.ts`, `live/`)
plus `playwright.config.ts`/`vitest.config.ts` at the repo root. See
docs/plans/P0.md §4.6 for the P0 spec list and PLAN.MD §4.8 for the P1 spec
table (not all of it exists yet — M1/M2 added `api/**/*.test.ts`,
`src/sync/**/*.test.ts`, `src/db/**/*.test.ts` coverage for the Dexie v2
upgrade/outbox/`mergeRemote*`, and `scripts/sync-integration.test.ts`; the
Playwright spec rewrite for the server-backed job model is M3).

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
key path is temporary: M1 added the server-side fake provider (below),
and M3 moves annotation server-side and deletes the browser client, the
`apiKeyOverride` setting, and `seedApiKey` along with it.

## Server-side fake provider and cookies (M1)

`api/**` handler tests (`api/*.test.ts`, `api/_lib/**/*.test.ts`) run the
real handlers against the `memory` `BlobStore`: `beforeEach` calls
`resetMemoryStoreForTests()` (`api/_lib/store/memory.ts`) and sets
`process.env.BLOB_BACKEND = 'memory'`, `ALLOW_TEST_MODE = '1'`,
`MODEL_PROVIDER = 'fake'`, then builds requests with a real `Request` and a
`cookie` header carrying a unique `thai_ns` (memory store isolation between
tests in the same process) plus whichever of `thai_model`,
`thai_fake_error`, `thai_step_budget_ms`, `thai_fake_delay_ms` the test
needs (see `.claude/rules/api.md`'s cookie table). `thai_fake_delay_ms`
exists specifically because a tiny `thai_step_budget_ms` shrinks
`lineReserveMs` too, so without a forced per-line delay a fake-provider job
can finish in a single step even under a 1-2 second budget — `job-hop`/
`job-cancel`-style tests need the delay to make the multi-step behavior
observable at all.

`e2e/fixtures.ts` will gain a `seedServer(snapshot)` fixture (`POST
/api/test/seed`, `ALLOW_TEST_MODE` only) once the Playwright spec rewrite
(M3) needs server-owned test state (stalled jobs, remote-only records);
until then, `window.__thai.importSnapshot` covers everything the fast
suite seeds.

## `scripts/sync-integration.test.ts` (M1↔M2 acceptance, PLAN.MD §5)

Drives the real client sync code (`src/sync/**`, `src/db/**`, `fake-
indexeddb` via `vitest.setup.ts`) against the real M1 handlers in-process —
no HTTP server, no mocks of either side. `scripts/testHandlerFetch.ts`
(test-only, not imported by any runtime `api/**` file) maps a relative
`/api/<path>` request to the matching handler module's method export and
calls it with a real, absolute-URL `Request`, so `src/sync/api.ts`'s
`createApi(fetchImpl)` can be pointed at it exactly the way it would be
pointed at the real global `fetch` in the browser. Lives under `scripts/`
(covered by `tsconfig.node.json`'s `include` and `vitest.config.ts`'s
`scripts/**/*.test.ts`), not `src/sync/` or `api/`, specifically so that no
runtime file under `api/**` ever imports `src/db` (CLAUDE.md hard rule 1).
Covers: a full create+rename+setting push, a server manifest listing them,
a simulated "new browser" (every local Dexie table cleared) followed by a
pull that reproduces the records identically; a newer/older/tied-tombstone
`PUT /api/sync/record`, exercising `pickWinner`'s LWW and tie-break rules
at both the server (the PUT response) and the client (a subsequent
`pull()`, via `src/sync/pull.ts`'s `shouldPull` — see
`.claude/rules/data.md`'s pull section for the rule itself); a full `POST
/api/annotate` run against the fixture dialogue, polled to completion via
`watchAnnotation`/`pollNow`; and that a successful push empties the outbox
while a pull never enqueues one.

## `scripts/smoke-runner.ts` (M1 acceptance, PLAN.MD §5)

`pnpm exec tsx scripts/smoke-runner.ts`: builds the app, starts `pnpm
preview` on a hardcoded port (4175, independent of `E2E_PORT` below) with
the `disk` Blob backend pointed at a fresh temp dir (`BLOB_DISK_ROOT`),
`MODEL_PROVIDER=fake`, `ALLOW_TEST_MODE=1`, then drives a real 8-line job
with `thai_fake_delay_ms=1000` + `thai_step_budget_ms=1500` (forcing ≥ 2
steps and ≥ 1 hop) to completion over real HTTP, deletes its `thai_ns`
namespace, and stops the server via its process group. Not part of `pnpm
test`/`pnpm test:e2e` — run it by hand after touching the runner/hop/
provider code.

## Playwright webServer env and `E2E_PORT`

The local fast suite's `webServer` runs `pnpm build && pnpm preview --port
$E2E_PORT --strictPort` (default port `4173`; `E2E_PORT` exists so two
Playwright runs — e.g. this repo's and an agent worktree's — never
silently reuse each other's `reuseExistingServer` build) with `env: {
BLOB_BACKEND: 'memory', MODEL_PROVIDER: 'fake', ALLOW_TEST_MODE: '1',
STEP_BUDGET_MS: '250000' }` — the API layer always runs the in-memory store
and the fake provider locally, never touching real Blob or Anthropic.

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
both assert `GET /api/health`'s shape and that unknown `/api/*` is a JSON
`404`, not the SPA's `index.html`. `E2E_REAL_MODEL=1` (a real-model smoke)
is a P1/M4 addition, not yet wired up.

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

`scripts/import-extensions.test.ts` enforces `.claude/rules/api.md`'s rule
that every relative import inside `api/**`, `src/lib/**`, and `src/llm/**`
ends in `.js` (a `.json` specifier is allowed only with `with { type:
'json' }`). Treat a failure there the same as any other `pnpm test`
failure — it's catching a real Vercel runtime crash
(`ERR_MODULE_NOT_FOUND`), not a style nit.

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

The same pattern applies in a plain Vitest test with no page at all
(`scripts/sync-integration.test.ts`'s annotate scenario): call
`pollNow()`/re-read the local record inside `expect.poll(async () => ...)`
rather than a fixed `await sleep(n)`, since the fake provider's per-line
delay (and therefore how many polls it takes) is deliberately variable
across scenarios.

## Prefer `test.fixme` over weakened assertions

If a spec can't be made to pass without loosening what it actually checks
(e.g. dropping an assertion, widening a selector until it's meaningless),
mark it `test.fixme('reason')` instead (Playwright) and leave a note —
never weaken an assertion just to turn a test green. Vitest has no
`test.fixme`; use `it.fails('reason', fn)` there instead (keep the real,
unweakened assertion — `it.fails` inverts pass/fail, so the test goes green
today by documenting the bug, and turns red — the signal to remove
`.fails` — the day someone fixes it).

## Speed budget

Full local Playwright suite must stay under 60s wall-clock:
`fullyParallel: true`, Chromium only, one shared `webServer`, no
`waitForTimeout` polling loops. Shard if it creeps up as specs are added.
