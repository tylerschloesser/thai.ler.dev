# thai.ler.dev

A personal Thai-learning web app: paste a dialogue, run it through Claude,
and get a layered annotation — dialogue → line → sentence → word →
syllable — with romanization, gloss, tone, and learner notes.

The Anthropic call runs entirely on the server: `api/` Vercel Functions hold
the key and do the annotation work (`POST /api/annotate` returns almost
immediately with a job, then the server keeps working in the background,
resuming itself across a 300s function limit and across the browser closing
entirely). Records live in Vercel Blob; the browser's IndexedDB (via Dexie)
is a local read model that pulls and pushes through `src/sync`, so the app
still reads offline. See `PLAN.MD` for the full P1 design and
`docs/plans/P0.md` for the P0 (client-only) architecture this replaced.

Production is **`https://thai.ler.dev`**, gated by Vercel Authentication
like every preview (see [Deploying](#deploying)). `PLAN.MD`'s M6 record
covers the cutover.

Stack: Vite + React 19 + TypeScript, Base UI + CSS Modules + Radix Colors,
TanStack Router/Query/Form, Dexie, Vercel Functions + Blob,
`@anthropic-ai/sdk`, Vitest + Playwright.

## Running it

```sh
pnpm install    # node_modules must be installed first; exact versions are pinned in pnpm-lock.yaml
pnpm dev        # local dev server (http://localhost:5173); also serves /api/*
pnpm build      # typecheck + production build
pnpm preview    # serve the production build; also serves /api/*
```

`scripts/vite-api-plugin.ts` mounts `api/**` handlers inside `vite dev` and
`vite preview`, so `pnpm dev` is a complete local stack — **no API key is
needed in the browser**, because the browser never talks to Anthropic. If
`ANTHROPIC_API_KEY` isn't exported in your shell, `MODEL_PROVIDER` falls
back to a fake provider (`api/_lib/providers/fake.ts`) that returns
schema-valid annotations from `src/fixtures/sample.annotation.json` (or a
synthesized minimal one for any other text) instead of calling Anthropic —
so the app is fully usable, end to end, with zero setup. Export the key to
exercise the real model locally:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
pnpm dev
```

Blob storage defaults to a `disk` backend (`.data/blob/`, gitignored) so
jobs survive a dev-server restart; there's no need for a real Vercel Blob
store for local development.

## Testing

```sh
pnpm check            # lint + typecheck + format:check (run before every commit)
pnpm test             # Vitest unit tests (src/, api/, scripts/)
pnpm test:e2e         # Playwright against a local `vite preview`
pnpm test:e2e:vercel  # deploy a fresh CLI preview and run only the @live specs
```

`pnpm test` and `pnpm test:e2e` never call the real Anthropic API: the
server always uses the fake provider in test mode
(`MODEL_PROVIDER=fake`/the `thai_model` cookie), and `e2e/fixtures.ts`
installs a guard on `https://api.anthropic.com/**` that fails any test
whose browser page requests it. `pnpm test:e2e:vercel` runs the five
`@live` specs (`e2e/live/{health,annotate,hop,sync,real-model}.spec.ts`)
against a real Vercel preview deployment and its real Blob store — still
the fake provider by default, and a small, budgeted number of Blob
operations (≈ 40 advanced / ≈ 80 simple ops per run, `PLAN.MD` §4.3). The
one exception is `live/real-model`, which calls the real Anthropic API and
only runs when invoked as `E2E_REAL_MODEL=1 pnpm test:e2e:vercel` — skipped
otherwise, and never run as part of the normal gate. `pnpm test:e2e:vercel`
has run green twice against a CLI preview (7 passed, `real-model`
skipped), plus once more with `E2E_REAL_MODEL=1` (8/8) — see
`.claude/rules/testing.md` and `PLAN.MD` §10 for the recorded numbers.
Against production (test mode is off there, so this is the one `@live`
spec that's meaningful), run after every push to `main`:

```sh
E2E_TARGET=production PLAYWRIGHT_BASE_URL=https://thai-ler-dev.vercel.app \
  pnpm exec playwright test e2e/live/health.spec.ts
```

See `.claude/rules/testing.md` for the mock contract, cookie-based
test-mode overrides, and namespace isolation.

## Deploying

The Vercel project is Git-connected with production branch **`main`** —
pushing `main` after the full gate (`pnpm check && pnpm test && pnpm
test:e2e`, then `pnpm test:e2e:vercel`) deploys production at
`https://thai.ler.dev`. The `vercel` branch, where P0 and P1 were built,
is retired; the AWS/CDK app that used to live on `main` is kept as the tag
`archive/aws-main`. The CLI stays preview-only:

```sh
pnpm deploy:preview   # `vercel deploy --yes` — preview only, always
```

**`vercel --prod` / `vercel deploy --prod` must never be run** — deploys to
production are Git-triggered only, never CLI-triggered. See
`.claude/rules/deploy.md` for the full Git/env/Blob-store picture, the
Deployment Protection and WAF settings, and the post-push production
check.

### Environment variables

| Variable                          | Where it lives                                                                                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`               | Vercel `production` **and** `preview` env (both sensitive); shell export locally                                                  | Read at runtime only by `api/**` handlers — never inlined into the client bundle (`vite.config.ts` has no `envPrefix`). Falls back to the fake provider when unset locally.                                                                                                                                                                                                                                                |
| `INTERNAL_SECRET`                 | Vercel `production`, `preview`, `development` (all sensitive/plain per env); defaults to `local-dev` locally                      | Authenticates the runner's self-continuation hop (`POST /api/annotation/step`).                                                                                                                                                                                                                                                                                                                                            |
| `ALLOW_TEST_MODE`                 | Vercel `preview`/`development` only, **never** `production`                                                                       | Enables the `thai_*` test cookies and `/api/test/*`; `api/_lib/env.ts` refuses to start if this is ever `1` with `VERCEL_ENV=production`.                                                                                                                                                                                                                                                                                  |
| `BLOB_READ_WRITE_TOKEN`           | Auto-provisioned per Blob store (`thai-ler-dev-prod` for production, `thai-ler-dev-preview` for preview/development, both `iad1`) | Used by `@vercel/blob`; irrelevant to the `disk`/`memory` backends.                                                                                                                                                                                                                                                                                                                                                        |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Local `.env.local` (gitignored)                                                                                                   | Lets Playwright and `scripts/e2e-vercel.sh` get past Vercel Authentication on preview **and production** URLs via an `x-vercel-protection-bypass` header. **Never** `vercel env pull` into `.env.local` — that command doesn't fetch this secret and would silently strand the file without it. Regenerate it in the dashboard (Settings → Deployment Protection → Protection Bypass for Automation) if it's ever missing. |

See `.claude/rules/deploy.md` and `.claude/rules/api.md` for the complete
per-environment table and the local-loader details
(`scripts/load-env.ts`).

## Security

The Anthropic key never reaches the browser: it lives only in the `api/`
Vercel Functions' runtime environment, read once per invocation
(`api/_lib/providers/anthropic.ts`), and the built client bundle is checked
for leaks on every `pnpm test:e2e` run (`e2e/bundle.spec.ts` greps
`dist/assets/*.js` for an API-key shape, a Blob read-write token, the
browser-only SDK flag, and any reference to `api.anthropic.com`).

Every deployment — preview and production alike — sits behind Vercel
Authentication ("All Deployments"), so a random visitor can't load the page
at all without signing in through Vercel; that's true at both
`https://thai.ler.dev` and the underlying
`https://thai-ler-dev.vercel.app`. A WAF rule additionally rate-limits
`POST /api/*` to 60 requests/minute per IP. See `PLAN.MD` §4.6 for the full
auth/secrets design (the hop's internal secret, the WAF rate limit, and the
`production` branch tracking) and `.claude/rules/deploy.md` for the
Deployment Protection, WAF, and DNS details.

## Moving your P0 library

The P0 library lives in the browser's IndexedDB on whichever origin you
used before the cutover (a P0 preview URL), and doesn't move itself —
it's a one-off, by hand: **Settings → Export** there to get a snapshot
file, then **Settings → Import** once on `https://thai.ler.dev`. The
outbox pushes the imported records to Blob on the next sync, same as any
other local write.

## Operations

Three failure modes are expected to happen occasionally on a Hobby plan,
and the app is built to degrade readably rather than crash when they do
(PLAN.MD §5 M5, §9 risks). None of these require Tyler to do anything
urgent — the library stays readable offline in every case.

### Cloud sync store suspended (Blob quota exhausted)

**Symptom**: annotating a new dialogue fails with a toast reading "Cloud
sync is paused: the Vercel Blob store is suspended until its monthly quota
resets. Your library still works offline." — and a manual "Sync now" in
Settings fails with the same message, shown as that section's last-sync
error (`useSync`'s `lastError`). The server maps
`@vercel/blob`'s `BlobStoreSuspendedError` to this message
(`api/_lib/store/vercel.ts`'s `StoreSuspendedError`, mapped to a `fail
('store', ...)` response by `api/_lib/http.ts`'s `failFromError`) whenever
a Hobby store goes over its monthly Advanced/Simple ops budget (the budget
itself is tracked in `PLAN.MD` §4.3).

**What still works**: everything already synced is still in IndexedDB and
fully usable — reading, browsing, and re-reading existing annotations never
touch the network. Only _new_ annotation runs and sync push/pull are
blocked until the store is unsuspended.

**What to do**: a suspended Hobby store lifts automatically when its
30-day usage window resets — there's no button to force it back on. To
confirm the cause and check how close the account is to the limit again:
Vercel dashboard → Storage → the affected store (`thai-ler-dev-preview` or
`thai-ler-dev-prod`) → **Usage**. If it's suspended well before the month
is up, that's a signal to revisit the §4.3 ops budget (fewer manifest
writes per job, a coarser flush cadence, etc.) rather than to wait it out
every time.

### Provider 401 (Anthropic API key rejected)

**Symptom**: every line of a new or resumed annotation fails with "The
server's Anthropic API key was rejected — rotate ANTHROPIC_API_KEY in the
Vercel project." (`src/llm/annotateLine.ts` maps
`Anthropic.AuthenticationError` to this message; it lands in that line's
`lineErrors[i]` and surfaces as a per-line toast in `DialogueView`). This
means the key in the server's environment is missing, revoked, or expired
— never a Settings problem, since the browser has no Anthropic client or
key of its own as of M3.

**What to do**: rotate the key in whichever Vercel environment is
affected (`preview` and/or `production`), then redeploy so the new value
is picked up:

```sh
printf '%s' "$ANTHROPIC_API_KEY" | vercel env add ANTHROPIC_API_KEY preview --sensitive --force
# and/or:
printf '%s' "$ANTHROPIC_API_KEY" | vercel env add ANTHROPIC_API_KEY production --sensitive --force
```

Never `echo` the key into a command (it would land in shell history).
After rotating, redeploy (`pnpm deploy:preview` for a preview; production
picks the new value up on the next push to `main`) — an already-running Vercel Function keeps its old environment
until the next deploy.

### Hop 508 (Vercel recursion protection)

**Symptom**: a long job's step count stalls with `run.state: 'running'`
and an already-past `leaseUntil` (visibly "stalled" in the UI) after using
up to `MAX_HOPS` (3) continuation hops. This happens when Vercel's
recursion-protection middleware answers the runner's self-invocation
(`POST /api/annotation/step`) with `508 INFINITE_LOOP_DETECTED` past an
unpublished hop count — `api/_lib/hop.ts`'s `hop()` never throws on this
(or any non-202 response), it just returns `false`, and the runner
(`api/_lib/runner.ts`) leaves the record stalled rather than crashing.

**What to do**: nothing has to be done by hand. Reopening the dialogue
(`/d/:id`) is the fix — `DialogueView`'s resume-on-open effect
(`src/sync/poll.ts`'s `watchAnnotation`) notices the stalled lease and
calls `POST /api/annotation/resume`, which starts a **fresh** hop lineage
(a new `run.hops` count) and finishes the remaining lines. This is the
documented worst case for a job that needs more than `MAX_HOPS` internal
continuations in one browser session (PLAN.MD §9 risks) — it still
finishes, just not without the page being reopened once.

## Project layout

- `api/` — Vercel Functions (`_lib/` is not routed): the annotation runner,
  Blob-backed record storage, sync endpoints; see `.claude/rules/api.md`
- `src/app/` — router setup, providers, theme, the `window.__thai` debug hook
- `src/routes/` — file-based routes (TanStack Router); `src/routeTree.gen.ts`
  is generated, commit it, never hand-edit it
- `src/db/` — Dexie schema, the sole local write path (`repo.ts`), settings,
  snapshot export/import, the outbox
- `src/sync/` — the client sync loop: pull, push, per-job polling, status
- `src/llm/` — prompt, schema, the per-line annotation call, the
  `LineProvider` interface shared with `api/_lib/providers/`
- `src/ui/` — Base UI wrapper components, styled with CSS Modules and
  semantic tokens
- `src/styles/` — `tokens.css` (semantic design tokens), `global.css`,
  `reset.css`
- `src/features/` — page-level feature components (dialogues, annotate,
  settings)
- `src/fixtures/` — the committed sample annotation used by the fake
  provider and the dev "Load sample" button
- `e2e/` — Playwright specs, `fixtures.ts`, `mocks/` (a Vitest-only SSE
  helper), `live/` (`@live` specs against a real preview)
- `scripts/` — `gen-fixture.ts` (regenerates the fixture with a real key),
  `e2e-vercel.sh`, `load-env.ts`, `vite-api-plugin.ts`, `smoke-runner.ts`,
  `sync-integration.test.ts`

See `CLAUDE.md` and `.claude/rules/*.md` for the rules an editing agent
follows in each of these areas, `PLAN.MD` for the current (P1) plan, and
`docs/plans/P0.md` for the P0 architecture and milestone history. See
[Operations](#operations) above for the three documented failure drills.
