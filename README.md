# thai.ler.dev

A personal Thai-learning web app: paste a dialogue, run it through Claude,
and get a layered annotation — dialogue → line → sentence → word →
syllable — with romanization, gloss, tone, and learner notes. Everything is
stored client-side in IndexedDB (via Dexie); there is no backend. The
Anthropic API call is made directly from the browser, which is why this
project is only ever deployed to a Vercel **preview** URL (see
[Deploying](#deploying) and [Security](#security-the-api-key-ships-in-the-client)
below).

Stack: Vite + React 19 + TypeScript, Base UI + CSS Modules + Radix Colors,
TanStack Router/Query/Form, Dexie, `@anthropic-ai/sdk`, Vitest + Playwright.

## Running it

```sh
pnpm dev       # local dev server (http://localhost:5173)
pnpm build     # typecheck + production build
pnpm preview   # serve the production build
```

`node_modules` must already be installed (`pnpm install`); this repo pins
exact dependency versions in `pnpm-lock.yaml`.

To actually run the annotation pipeline locally, export an API key before
starting the dev server, or paste one into Settings → API key override
(stored in this browser's IndexedDB only):

```sh
export ANTHROPIC_API_KEY=sk-ant-...
pnpm dev
```

## Testing

```sh
pnpm check          # lint + typecheck + format:check (run before every commit)
pnpm test           # Vitest unit tests
pnpm test:e2e       # Playwright against a local `vite preview` (mocked Anthropic API)
pnpm test:e2e:vercel  # deploy a fresh preview and run the same suite against it
```

`pnpm test` and `pnpm test:e2e` never call the real Anthropic API —
`e2e/fixtures.ts` routes every `api.anthropic.com` request through a
fixture-backed SSE mock by default, and fails any test that lets a request
fall through to the real endpoint. `pnpm test:e2e:vercel` runs against a
real deployment (see below) but still uses the same mock; it costs no
Anthropic usage, only Vercel deploy time. See `.claude/rules/testing.md`
for the mock contract and seeding conventions.

## Deploying

This project is deployed with the Vercel CLI. The Vercel project is also
Git-connected (production branch `main`, which never receives pushes), so a
push to `vercel` creates a preview deployment automatically; production is
never deployed.

```sh
pnpm deploy:preview   # `vercel deploy --yes` — preview only, always
```

**`vercel --prod` / `vercel deploy --prod` must never be run.** See
[Security](#security-the-api-key-ships-in-the-client) for why.

### Environment variables

| Variable                          | Where it lives                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`               | Vercel project → `preview` environment | Set it via `printf '%s' "$ANTHROPIC_API_KEY" \| vercel env add ANTHROPIC_API_KEY preview`. It must be added as a **non-sensitive** variable. Vercel's "sensitive" env vars are runtime-only (readable only by the server at request time), but this is a static Vite app: `ANTHROPIC_API_KEY` is inlined into the client bundle at _build_ time via `envPrefix`, so it must be readable during the build step. A sensitive var would build successfully but silently bake in an empty string.                                                                                                                                                   |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Local `.env.local` (gitignored)        | Lets Playwright and `scripts/e2e-vercel.sh` get past Vercel's SSO deployment protection on preview URLs, via an `x-vercel-protection-bypass` header. **Do not** run `vercel env pull .env.local` to get this — that command only pulls system/git-scoped env vars and omits the bypass secret entirely, so it would silently overwrite `.env.local` and delete the secret. Verify it against the live project instead with `vercel api "/v9/projects/<id>?teamId=<team>"` and compare the `protectionBypass` value. If it's ever missing, regenerate it in the dashboard (Settings → Deployment Protection → Protection Bypass for Automation). |

## Security: the API key ships in the client

This is a P0/personal-project tradeoff, not an oversight: `ANTHROPIC_API_KEY`
is inlined into the JavaScript bundle at build time so the browser can call
`api.anthropic.com` directly with no backend. Anyone who can load the page
can read the key out of the bundle.

That's tolerable _only_ because:

- Every deploy is a **preview** URL, and Vercel's Standard Protection puts
  every `*.vercel.app` preview behind SSO — a random visitor can't load the
  page at all, let alone extract the key.
- The production alias is never deployed to. `vercel --prod` is banned by
  convention (see `.claude/rules/deploy.md`) and by habit — there is no CI
  gate enforcing it, so don't run it.

A server-side proxy for the Anthropic call (removing the key from the
client entirely) is a known follow-up, not yet built — it is the subject of
`PLAN.MD` (the P1 plan); see also the "Next" list in `docs/plans/P0.md`.

## Project layout

- `src/app/` — router setup, providers, theme, debug hook, Anthropic client wiring
- `src/routes/` — file-based routes (TanStack Router); `src/routeTree.gen.ts` is generated, commit it, never hand-edit it
- `src/db/` — Dexie schema, the sole write path (`repo.ts`), settings, snapshot export/import
- `src/llm/` — prompt, schema, client, per-line annotation pipeline
- `src/ui/` — Base UI wrapper components, styled with CSS Modules and semantic tokens
- `src/styles/` — `tokens.css` (semantic design tokens), `global.css`, `reset.css`
- `src/features/` — page-level feature components (dialogues, annotate, settings)
- `src/fixtures/` — the committed sample annotation used by the e2e mock and dev "Load sample" button
- `e2e/` — Playwright specs, fixtures, and the Anthropic SSE mock
- `scripts/` — `gen-fixture.ts` (regenerates the fixture with a real key) and `e2e-vercel.sh`

See `CLAUDE.md` and `.claude/rules/*.md` for the rules an editing agent
follows in each of these areas, `PLAN.MD` for the current plan, and
`docs/plans/P0.md` for the P0 architecture and milestone history.
