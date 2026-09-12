---
paths:
  - 'e2e/**'
  - '**/*.test.ts'
  - 'playwright.config.ts'
  - 'vitest.config.ts'
---

# Testing rules

`e2e/` (Playwright specs, `fixtures.ts`, `mocks/anthropic.ts`) plus
`playwright.config.ts`/`vitest.config.ts` at the repo root. 19 Playwright
specs and 70 Vitest tests exist today; see PLAN.MD §4.6 for the spec list.

## Mock contract

Tests never touch the real Anthropic API. `e2e/fixtures.ts` extends `test`
with a default route on `https://api.anthropic.com/v1/messages`: the
handler reads `route.request().postDataJSON()`, finds the `<target
line="N">` text in the message content, looks up the matching line in
`src/fixtures/sample.annotation.json`, and replies with an SSE body built
by `e2e/mocks/anthropic.ts` (`message_start` → `content_block_start` →
`content_block_delta` chunks → `content_block_stop` → `message_delta` →
`message_stop`). A test that lets an unmocked request reach
`api.anthropic.com` must fail, not pass silently — assert on request count
or use a route that errors on fallthrough.

## Seeding

Seed state through `window.__thai.importSnapshot(snapshot)` via
`page.evaluate`, not by driving the UI to create fixture data. `window.__thai
= { db, importSnapshot, exportSnapshot }` is always present (not test-only)
so this hook must keep working as the app evolves.

## Speed budget

Full Playwright suite must stay under 60s wall-clock: `fullyParallel: true`,
Chromium only, one shared `webServer` (`vite preview` on 4173 unless
`PLAYWRIGHT_BASE_URL` is set), no `waitForTimeout` polling loops. Currently
~7s locally for 19 specs; shard if it creeps up as specs are added.

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

## Running against Vercel

`pnpm test:e2e:vercel` runs `scripts/e2e-vercel.sh`, which deploys a preview
(`vercel deploy --yes`, never `--prod`) and runs the suite with
`PLAYWRIGHT_BASE_URL` set to the preview URL. Against a remote target,
`playwright.config.ts` sets `retries: 1` (vs. `0` locally) and adds
`extraHTTPHeaders`: `x-vercel-protection-bypass:
$VERCEL_AUTOMATION_BYPASS_SECRET` and `x-vercel-set-bypass-cookie: true` so
requests pass Vercel's SSO deployment protection. This also validates the
`vercel.json` SPA rewrite for deep links like `/settings` and `/d/$id`.
