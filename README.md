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

Production is **not yet deployed** — every deploy today is a Vercel
**preview** URL, gated by Vercel Authentication (see
[Deploying](#deploying)). `PLAN.MD`'s M6 is the production cutover.

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
whose browser page requests it. `pnpm test:e2e:vercel` runs the `@live`
specs (`e2e/live/`) against a real Vercel preview deployment and its real
Blob store — it costs no Anthropic usage (still the fake provider by
default) and a small, budgeted number of Blob operations. See
`.claude/rules/testing.md` for the mock contract, cookie-based test-mode
overrides, and namespace isolation.

## Deploying

The Vercel project is Git-connected (production branch `main`, which never
receives pushes) and separately deployable via the CLI. A push to `vercel`
creates a Git-triggered preview automatically; production is not deployed
until `PLAN.MD`'s M6 cutover.

```sh
pnpm deploy:preview   # `vercel deploy --yes` — preview only, always
```

**`vercel --prod` / `vercel deploy --prod` must never be run.** See
`.claude/rules/deploy.md` for the full Git/env/Blob-store picture.

### Environment variables

| Variable                          | Where it lives                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`               | Vercel project → `preview` env (sensitive); shell export locally | Read at runtime only by `api/**` handlers — never inlined into the client bundle (`vite.config.ts` has no `envPrefix`). Falls back to the fake provider when unset locally.                                                                                                                                                                                                                             |
| `INTERNAL_SECRET`                 | Vercel `preview`/`development`; defaults to `local-dev` locally  | Authenticates the runner's self-continuation hop (`POST /api/annotation/step`).                                                                                                                                                                                                                                                                                                                         |
| `ALLOW_TEST_MODE`                 | Vercel `preview`/`development` only, **never** `production`      | Enables the `thai_*` test cookies and `/api/test/*`; `api/_lib/env.ts` refuses to start if this is ever `1` with `VERCEL_ENV=production`.                                                                                                                                                                                                                                                               |
| `BLOB_READ_WRITE_TOKEN`           | Auto-provisioned per Blob store                                  | Used by `@vercel/blob`; irrelevant to the `disk`/`memory` backends.                                                                                                                                                                                                                                                                                                                                     |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Local `.env.local` (gitignored)                                  | Lets Playwright and `scripts/e2e-vercel.sh` get past Vercel Authentication on preview URLs via an `x-vercel-protection-bypass` header. **Never** `vercel env pull` into `.env.local` — that command doesn't fetch this secret and would silently strand the file without it. Regenerate it in the dashboard (Settings → Deployment Protection → Protection Bypass for Automation) if it's ever missing. |

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

Every preview and (once deployed) production deployment sits behind Vercel
Authentication ("All Deployments"), so a random visitor can't load the page
at all without signing in through Vercel. That's what makes it safe to keep
deploying previews before the M6 production cutover — see `PLAN.MD` §4.6
for the full auth/secrets design (the hop's internal secret, the WAF rate
limit, and the cutover's `production` branch tracking).

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
`docs/plans/P0.md` for the P0 architecture and milestone history. The full
operations runbook (failure drills, monitoring) is a `PLAN.MD` M5 item, not
written yet.
