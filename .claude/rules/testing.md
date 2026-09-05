---
paths:
  - "e2e/**"
  - "apps/api/src/local.ts"
  - "apps/api/src/fixtures/**"
  - "apps/api/src/model/fake.ts"
  - "apps/api/src/store/memory.ts"
---

# e2e

Loaded when you touch the Playwright suite (`e2e/`) or the local-only API pieces it runs
against.

- `pnpm test:e2e` (`pnpm --filter e2e test`) starts two servers via
  `e2e/playwright.config.ts`: `pnpm --filter api start` on `:8787` (in-memory store, fake
  model, `AUTH=header`, `FAKE_MODEL_DELAY_MS=500`) and a **built** web app under `vite preview`
  on `:4173`, which proxies `/api` to `:8787`; `baseURL` is `:4173`. The suite runs against
  `preview`, not `dev`, because the service worker only registers against a build and offline
  behavior is the point. It uses `start`, not `dev`, on the API side too: `dev` runs under `tsx
  watch`, and a file save mid-run would restart the process and wipe the in-memory store out
  from under in-flight tests.
- `reuseExistingServer: !CI` — locally, a stale `vite preview` from a previous build is reused
  as-is. After changing `apps/web`, kill it (or let the config rebuild) or you're testing the
  old bundle.
- `e2e/fixtures.ts` mints a per-test `x-id-token` (`extraHTTPHeaders`), and `AUTH=header` on the
  local API treats that header as the whole identity — a distinct token is a distinct, empty
  data partition. That's what makes `fullyParallel` safe: no test can see another's rows. Use
  the fixture's `createExample(page)` and `expectIndicator(page, text, options?)` rather than
  re-deriving them.
- The fake model (`src/model/fake.ts`) is deterministic from its input: `[fake] <line>`
  translations, `Fake breakdown of N line(s).`, `[fake] You asked "<q>" about <selection>`. A
  row whose source text contains `FAIL` fails its first attempt, but only **once per row id per
  process** (an in-memory `Set`) — a restart forgets it, so plan fail-then-retry within one run.
- Results arrive by a 3 s poll (`apps/web/src/db/usePendingPoll.ts`), so a ready row can take up
  to ~3.5 s to show. Budget ~5 s and let the config's 10 s `expect` timeout cover it — don't add
  a sleep to wait for the poll. The `waitForTimeout` calls in `offline.spec.ts` are the only
  exception: a fixed window with the network cut is the scenario itself, not something to skip
  past, and there is no event to await for it.
- Selectors are roles and names — there is no `data-testid` anywhere. Two names are ambiguous:
  **`Try again`** has four call sites, scope with
  `page.getByRole('alert').getByRole('button', { name: 'Try again' })`; **`Delete`** has two,
  scope with `page.locator('article > header').getByRole('button', { name: 'Delete' })`. A
  **ready** row renders no status pill at all, so "it finished" is
  `expect(page.locator('[data-status]')).toHaveCount(0)`, not a `Ready` pill.
- **Two known bugs shape what the specs may assert.** Neither is a test problem, and neither
  should be papered over by weakening an assertion.
  [#1](https://github.com/tylerschloesser/thai.ler.dev/issues/1): a *second* offline reload — one made
  after a refetch has already failed with no network — comes back with an empty list, synced
  rows included, though the outbox survives; `offline.spec.ts` carries that as a `test.fixme`,
  and dropping the `fixme` is how to check whether the fix landed.
  [#2](https://github.com/tylerschloesser/thai.ler.dev/issues/2): a finished row never
  reaches the **home list** — the 3 s poll fires once and stops — so "it went ready" can only
  be asserted on the detail route, which is why `translate.spec.ts` opens the row and
  `offline.spec.ts` waits on the sync indicator instead of on the pill.
- Debugging a failure: `pnpm --filter e2e test --headed`, `--ui` or `--debug` for a live
  browser, `pnpm exec playwright show-trace <path>` for a CI trace; the `playwright-cli` skill
  drives a browser directly for ad hoc exploration.
- This suite does not replace `verify-offline`: Playwright's `setOffline` is not a real network
  drop, and the skill still covers what a human has to eyeball after touching
  `apps/web/src/db/` or the service worker.
