---
name: verify-offline
description: Walk the five browser-only offline checks for the Thai reader — offline cold start, optimistic rows surviving an offline reload, outbox drain on reconnect, multi-tab leader election, and failed-row retry. Use after changing apps/web/src/db/, the route loaders, or the service worker config; lint, typecheck and build cannot catch regressions there.
allowed-tools: Bash(playwright-cli:*) Bash(pnpm:*)
---

# Verify the offline paths

Nothing here is covered by `pnpm lint && pnpm typecheck && pnpm build`. These five checks are
the regression suite for `apps/web/src/db/` and the service worker, run by hand in a real
browser through `playwright-cli`.

**Check 2 fails today**, on
[#1](https://github.com/tylerschloesser/thai.ler.dev/issues/1). That is the app, not this
walk — report the FAIL, and do not weaken the check to make it pass.

Snapshots and screenshots go to `.playwright-cli/`, which is gitignored; don't commit any
other capture.

## Setup

The service worker is **not registered under `pnpm dev`** (`vite-plugin-pwa` has no
`devOptions` in `apps/web/vite.config.ts`), so the cold-start check needs the production
build served by `vite preview`. Run everything against preview so one browser session covers
all five:

```bash
pnpm --filter api start        # the local API on :8787, keep it running
pnpm build
pnpm --filter web preview      # serves apps/web/dist at http://localhost:4173, keep it running
playwright-cli -s=offline open http://localhost:4173
```

That is a **local** backend — in-memory store, fake model, seeded demo rows — so nothing here
touches production. To walk the same checks against the deployed API instead, start the
preview with `API_TARGET=https://thai.ler.dev`; then every write below lands in production
data, so create exactly one throwaway translation and delete it at the end.

`pnpm test:e2e` (`.claude/rules/testing.md`) automates checks 1, 3, 4 and 5 against the same
local backend. This walk still earns its keep: Playwright's `setOffline` is not a real
network drop.

Toggling the network is a Playwright context call, not a CLI flag:

```bash
playwright-cli -s=offline run-code "async page => { await page.context().setOffline(true) }"
playwright-cli -s=offline run-code "async page => { await page.context().setOffline(false) }"
```

The header indicator is the `<output data-tone>` element rendered by `SyncIndicator`. Read
it directly rather than hunting through a snapshot:

```bash
playwright-cli -s=offline --raw eval "document.querySelector('output[data-tone]').textContent"
```

It reads one of `Synced`, `Syncing N`, `Online only`, `Offline`, or `Offline · N queued`.
A row's status shows as a pill reading `Working` or `Failed`; a ready row has no pill.

Before the first check, let the shell install and the cache fill: with the network on, wait
until the indicator reads `Synced`, then confirm the worker is active:

```bash
playwright-cli -s=offline run-code "async page => { await page.evaluate(() => navigator.serviceWorker.ready); return 'sw ready' }"
```

## The five checks

Run them in this order; 2 and 3 share one offline write.

### 1. Offline cold start

Go offline, **wait long enough for a refetch to fail**, then reload, then reload again. The
realistic cold start is an app that has already been open offline for a while, not one that
lost the network a moment ago; a reload straight after `setOffline(true)` passes even when
the persisted cache is being thrown away, because nothing has failed yet.

```bash
playwright-cli -s=offline run-code "async page => { await page.context().setOffline(true); await page.waitForTimeout(5000) }"
playwright-cli -s=offline reload
playwright-cli -s=offline run-code "async page => { await page.waitForFunction(() => !!document.querySelector('output[data-tone]'), null, { timeout: 15000 }); await page.waitForTimeout(5000) }"
playwright-cli -s=offline reload
playwright-cli -s=offline run-code "async page => { await page.waitForFunction(() => !!document.querySelector('output[data-tone]'), null, { timeout: 15000 }); await page.waitForTimeout(3000) }"
playwright-cli -s=offline --raw eval "JSON.stringify({ indicator: document.querySelector('output[data-tone]').textContent, rows: document.querySelectorAll('ul li a').length, alert: document.querySelector('[role=alert]')?.textContent ?? null })"
```

The first render after a reload is held until IndexedDB has been read back, so read the DOM
only after the indicator exists and a few seconds have passed; an immediate `eval` sees an
empty page and proves nothing.

PASS: after **both** reloads the list shows the same rows as before (or `Nothing yet…` on an
empty account) and the indicator reads `Offline`. FAIL: a browser error page, a blank root,
or `Couldn't load your translations.` with `GET /api/state?since=0` in `requests`; that last
shape means the persisted read cache was dropped, not that the shell failed to load.

### 2. Optimistic row survives an offline reload

Still offline. Create the throwaway translation, then reload before reconnecting.

```bash
playwright-cli -s=offline click "getByRole('button', { name: 'Use an example' })"
playwright-cli -s=offline click "getByRole('button', { name: 'Break it down' })"
playwright-cli -s=offline --raw eval "JSON.stringify({ indicator: document.querySelector('output[data-tone]').textContent, firstPill: document.querySelector('ul li a [data-status]')?.textContent })"
playwright-cli -s=offline run-code "async page => { await page.waitForTimeout(5000) }"   # let the outbox and persister settle
playwright-cli -s=offline reload
playwright-cli -s=offline run-code "async page => { await page.waitForFunction(() => !!document.querySelector('output[data-tone]'), null, { timeout: 15000 }); await page.waitForTimeout(3000) }"
playwright-cli -s=offline --raw eval "JSON.stringify({ indicator: document.querySelector('output[data-tone]').textContent, rows: document.querySelectorAll('ul li a').length, firstPill: document.querySelector('ul li a [data-status]')?.textContent ?? null })"
```

PASS: immediately after the click, the new row is at the top of the list with a `Working`
pill and the indicator reads `Offline · 1 queued`; after the reload both are still true.
This is the `hydrate()` → `offline.waitForInit()` path. FAIL: the row is missing after the
reload, or the queue count is 0.

### 3. Outbox drain on reconnect

Reconnect and watch the queue flush.

```bash
playwright-cli -s=offline run-code "async page => { await page.context().setOffline(false) }"
playwright-cli -s=offline run-code "async page => { await page.waitForFunction(() => document.querySelector('output[data-tone]').textContent === 'Synced', null, { timeout: 30000 }); return 'drained' }"
playwright-cli -s=offline requests
```

PASS: the indicator ends at `Synced` (the `Syncing 1` step is usually too brief to sample)
and the request log shows `POST /api/mutations` answered 200. The row's pill stays `Working` until the model finishes
(often a minute or more); that wait is not part of the check. FAIL: `Syncing 1` never
clears, or the POST is 4xx/5xx.

### 4. Multi-tab leader election

The first tab holds the outbox; a second tab must say it does not.

```bash
playwright-cli -s=offline tab-new http://localhost:4173
playwright-cli -s=offline --raw eval "document.querySelector('output[data-tone]').textContent"
playwright-cli -s=offline tab-close
playwright-cli -s=offline tab-select 0
playwright-cli -s=offline --raw eval "document.querySelector('output[data-tone]').textContent"
```

PASS: the new tab reads `Online only` (its title attribute explains another tab owns the
queue) and the original tab still reads `Synced`. Election can take a second; re-read once
before calling it a failure. FAIL: both tabs claim `Synced`, or the original tab loses
leadership.

### 5. Failed-row retry

This needs a row already in `failed` state; the client has no switch to force one, because a
failure is recorded by the worker. Against the local API the fake model fails any row whose
text contains `FAIL` (once per row id per process), so type `FAIL something` to produce one
on demand. Look for a `Failed` pill in the list. If there is none, report this check as
**SKIPPED**, not passed.

```bash
playwright-cli -s=offline snapshot                 # click the card whose pill reads Failed
playwright-cli -s=offline click <ref of the failed card>
playwright-cli -s=offline click "getByRole('button', { name: 'Try again' })"
playwright-cli -s=offline snapshot
playwright-cli -s=offline requests
```

PASS: the pill flips to `Working` and the detail shows `Breaking it down…` immediately, and
a `POST /api/mutations` succeeds. Retry is a plain `status: 'pending'` update, so the same
steps work offline: the flip is immediate and the POST happens on reconnect. Whether the row
then reaches `Ready` is the worker's business, not this check's; if it drops back to `Failed`
within seconds, read the error text in the alert (it is the worker's reason, for example an
Anthropic API billing error) and report it alongside the PASS. FAIL: the row stays `Failed`
after the click, or the UI blocks until the server answers.

## Cleanup

Open the throwaway translation from the list, click `Delete`, and confirm it leaves the list
and the indicator returns to `Synced`. Then:

```bash
playwright-cli -s=offline close
```

Stop the preview server you started.

## Report

One line per check: `1 cold start`, `2 optimistic reload`, `3 outbox drain`,
`4 leader election`, `5 failed retry`, each `PASS`, `FAIL`, or `SKIPPED`, followed by the
indicator text you observed. A FAIL includes the snapshot or request line that shows it.
Anything you learned about the server along the way (a worker error message, a slow drain)
goes on a final line; it is not a verdict on the client.
