---
paths:
  - 'e2e/**'
  - '**/*.test.ts'
  - 'playwright.config.ts'
  - 'vitest.config.ts'
---

# Testing rules

`e2e/` (Playwright specs, `fixtures.ts`, `mocks/anthropic.ts`, `live/`)
plus `playwright.config.ts`/`vitest.config.ts` at the repo root. Annotation
runs server-side as of M3 — there is no Vitest count in this file; it drifts
too fast to keep accurate here, run `pnpm test` to see it.

## Mock contract (`e2e/fixtures.ts`)

The Anthropic call never reaches the browser: `api/_lib/providers/fake.ts`
plays its role, selected per job via the `thai_model` cookie (`fake` or
`fake-slow`) every test context carries by default (`fake`). `e2e/fixtures.ts`
installs a Playwright route on `https://api.anthropic.com/**` as a **guard**,
not a mock — any request to it aborts and throws, failing the test
immediately (hard rule 2). There is no `apiKeyOverride`/`seedApiKey` fixture
and no `anthropicMockRoute`: the browser has no Anthropic client to seed a
key into (`src/llm/client.ts` is deleted).

Every test context also carries a `thai_ns` cookie (`e2e-<sanitized testId>`,
`sanitizeNs` in `fixtures.ts`), which becomes the server's Blob-store key
prefix (`api/_lib/context.ts`) — tests never see each other's dialogues or
annotations even though they share one `memory` store. The `context`
fixture's teardown calls `DELETE /api/test/namespace?ns=` through the
context's own `request` (so it carries the same cookie jar) after every
test.

Fixtures (`e2e/fixtures.ts`):

- `seed(snapshot)`: `window.__thai.importSnapshot` then `window.__thai.sync
.push()` — seeds local IndexedDB and pushes it to the server, for state a
  test wants to already exist both locally and remotely.
- `seedServer(snapshot)`: `POST /api/test/seed` (`ALLOW_TEST_MODE` only) —
  writes server-owned state directly, for a record that only makes sense as
  already existing remotely (a stalled job, a record with no local copy).
- `fakeError(kind | null)`: sets/clears `thai_fake_error` — the fake
  provider fails every line with that `AnnotateErrorKind` while set.
- `fakeDelay(ms | null)`: sets/clears `thai_fake_delay_ms` — overrides the
  fake provider's per-line delay (0ms for `fake`, 300ms for `fake-slow`).
- `stepBudget(ms | null)`: sets/clears `thai_step_budget_ms` — caps the
  runner's per-step budget, forcing hops.
- `newContextSameNs()`: opens a second, independent `BrowserContext`
  carrying the same `thai_ns`/`thai_model` cookies and Anthropic guard as
  the test's primary context — simulates "a different browser" pulling from
  the same server-side namespace. Auto-closed; the namespace itself is
  still only deleted once, by the primary `context` fixture's teardown.

See `.claude/rules/api.md`'s cookie table for the full cookie contract
(shared by these fixtures and by `api/**` handler tests).

## Current spec list (fast suite, as of M6 — run `ls e2e/*.spec.ts` to check)

`e2e/{smoke,theme,deep-link,word-popover,library,annotate,persistence,
errors,settings,api-health,bundle,sync,job-survives-tab,job-hop,
job-resume-on-open,job-cancel,sw-kill-switch}.spec.ts` (17 specs).
`sw-kill-switch` registers `public/sw.js` the way the retired AWS app did
and asserts it unregisters itself, empties Cache Storage and leaves
IndexedDB alone (`.claude/rules/deploy.md`). `bundle` reads the built
`dist/assets/*.js` with plain `node:fs` (no page/network) and asserts no
Anthropic key, no `vercel_blob_rw_` token, no `dangerouslyAllowBrowser`, and
no `api.anthropic.com` reference ever reaches the client bundle — it's
skipped when `PLAYWRIGHT_BASE_URL` is set (no local `dist/` to read against
a remote target).

### Job-lifecycle specs and the `isTerminal` convention

`job-survives-tab`, `job-hop`, `job-resume-on-open`, and `job-cancel`
(PLAN.MD §4.8, M3b) all drive a job through `src/sync/poll.ts`'s exported
`isTerminal(run, now)` — `run.state ∈ done | cancelled` **and** the lease is
`null` or expired — rather than a hand-rolled `state` check, because that's
the exact predicate the app itself uses to decide when to stop polling
(`DialogueView`'s resume-on-open effect uses the same export). Conventions
shared across them:

- `fakeDelay(ms)` (→ `thai_fake_delay_ms`) makes each line take long enough
  to observe a mid-flight state (`job-survives-tab`, `job-cancel`) or to
  combine with `stepBudget(ms)` (→ `thai_step_budget_ms`) to force ≥ 2
  steps and ≥ 1 hop (`job-hop`).
- `job-resume-on-open` uses `seedServer` instead — a `running` record with
  an expired lease and null lines exists only on the server (no local
  IndexedDB copy), so opening `/d/:id` is what triggers the client's own
  resume-on-open watch, not a job the test itself started.
- `job-cancel` asserts a cancelled record keeps its already-completed lines
  and that Retry (`resume`) still works afterward — the M3b regression this
  spec was written to catch (PLAN.MD §10 "Corrected during M3"). It drives
  this entirely through the client (`e2e/testUtils.ts`'s `tickPoll` →
  `window.__thai.sync.pollNow()` + `readAnnotationByDialogue` reading local
  IndexedDB), polling until the local record settles on `cancelled` **with**
  at least one completed line — not just the cancel endpoint's own
  immediate (still-all-null) response — then double-checks the same state
  landed server-side via one `GET /api/annotation`. `job-survives-tab`
  (which closes every page of the triggering context) instead polls purely
  over a fresh `newContextSameNs()`'s `context.request`, since there's no
  page left to run a client poller at all — checking `run.state === 'done'`
  there is checking the server's own truth, not the client's `isTerminal`
  gate.

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
`404`, not the SPA's `index.html`.

`e2e/live/` (M4, PLAN.MD §5) holds five specs plus one shared helper
module:

- `health` — as above.
- `annotate` — fake provider, real `waitUntil` + real Blob; a fresh context
  sees the job reach `done`.
- `hop` — `fake-slow` + a tiny `thai_step_budget_ms` forces ≥ 2 hops on the
  real Vercel runtime, proving the bypass header + `INTERNAL_SECRET`
  self-invocation path actually works past Vercel's recursion protection.
- `sync` — two contexts sharing one namespace: create in one, pull in the
  other.
- `real-model` — the **one** spec that calls the real Anthropic API, and
  only when explicitly asked: `test.skip(process.env.E2E_REAL_MODEL !==
'1', ...)` is the first line of the test body, so it's a no-op
  ("skipped") on every normal `pnpm test:e2e:vercel` run. Clears the
  `thai_model` cookie so the job falls through to the preview's real
  `MODEL_PROVIDER`, posts a 2-line dialogue on `claude-sonnet-5`, and
  validates every resulting line against `LineAnnotationSchema`. Run it
  once per milestone that touches `src/llm` or `api/_lib/providers` (≈
  $0.05 per run).
- `e2e/live/liveUtils.ts` — shared helpers (`buildDialogue`,
  `withSyntheticLines`, `postAnnotate`, `getAnnotation`,
  `pollAnnotationDone`) that drive `/api/annotate` + `/api/annotation`
  purely over `APIRequestContext`, no page — kept separate from
  `e2e/testUtils.ts` (page-only, `window.__thai`-based) because a job like
  `live/hop` must never have a page open: a page's own client poller could
  call `POST /api/annotation/resume` on what it sees as a stalled job and
  fork a second lineage instead of letting the one under test finish.

The live suite's estimated Blob cost is in PLAN.MD §4.3: ≈ 40 advanced +
≈ 80 simple ops for one full `@live` run (all 5 specs) — that's why it
should run at milestone ends, not on every push, and why `real-model` is
opt-in separately from the rest. As of M4, `pnpm test:e2e:vercel` has run
green twice in a row against CLI preview `thai-ler-9zvm97vro` (7 passed,
`real-model` skipped, ≈ 11s each), plus one 8/8 run with
`E2E_REAL_MODEL=1` against `thai-ler-ko3z03nvw` (≈ 112s, `claude-sonnet-5`,
2 lines). `live/hop` measured `run.hops = 2`, `run.steps = 3` on the real
Vercel runtime with no `508` — see PLAN.MD §10 "Corrected during M4" for
the full record. `live/health` has also passed against the Git-built
preview of `015067d`. See PLAN.MD §10/§4.2 for the recorded production
`live/health` result from the M6 cutover — a `pnpm test:e2e:vercel`/
production result, a measured hop count, or a real-model latency/cost
number is only fact once it's recorded there.

### Against production (`E2E_TARGET=production`)

Only `e2e/live/health.spec.ts` is meaningful against production (test mode
is off there, so every other `@live` spec's cookie-based overrides are
no-ops and `real-model`-style costs are real money). Run it with both the
target URL and the env switch after every push to `main` (a push is the
production deploy — this is the post-push check, `.claude/rules/deploy.md`):

```sh
E2E_TARGET=production PLAYWRIGHT_BASE_URL=https://thai-ler-dev.vercel.app \
  pnpm exec playwright test e2e/live/health.spec.ts
```

`E2E_TARGET=production` (default: preview) flips `health.spec.ts`'s own
assertions to expect `testMode: false`, the real `provider`, and `404` from
`/api/test/seed` / `/api/test/namespace` instead of preview's
`ALLOW_TEST_MODE=1` shape — it does not change `playwright.config.ts` or
any other spec. The run needs `VERCEL_AUTOMATION_BYPASS_SECRET` exported
(from `.env.local`) to get past Vercel Authentication on the production
URL, same as any preview.

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
