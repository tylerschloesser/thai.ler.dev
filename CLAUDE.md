# thai.ler.dev

A personal Thai-learning web app: paste a dialogue, run it through Claude,
and get a layered annotation (dialogue → line → sentence → word → syllable)
with romanization, gloss, tone, and learner notes. Everything is stored
client-side in IndexedDB. P1 is moving the Anthropic call to `api/` Vercel
Functions; as of M0, `api/` has a health endpoint and a Blob-store
abstraction, but annotation still runs by calling Anthropic directly from
the browser, and production is not yet deployed (previews only).

**Stack**: Vite + React 19 + TypeScript, Base UI + CSS Modules + Radix
Colors, TanStack Router/Query/Form, Dexie (IndexedDB), `@anthropic-ai/sdk`,
Vercel Functions + Blob, Vitest + Playwright, deployed via the Vercel CLI
and Git pushes (preview only, for now).

## Commands

- `pnpm dev` — local dev server; also serves `/api/*` (`scripts/vite-api-plugin.ts`)
- `pnpm build` — typecheck + production build
- `pnpm preview` — serve the production build (also serves `/api/*`)
- `pnpm check` — lint + typecheck + format:check (run before every commit)
- `pnpm test` — Vitest unit tests (`src/`, `api/`, `scripts/`, `e2e/**/*.test.ts`)
- `pnpm test:e2e` — Playwright against local `vite preview`, excludes `@live` specs
- `pnpm test:e2e:vercel` — deploy a CLI preview and run only the `@live` specs
- `pnpm deploy:preview` — `vercel deploy --yes` (preview only)
- `pnpm gen:fixture` — regenerate `src/fixtures/sample.annotation.json`

## Layout

- `.claude/` — context engineering: rules, agents, permissions
- `api/` — Vercel Functions (`_lib/` not routed) — see `.claude/rules/api.md`
- `e2e/` — Playwright specs, fixtures, the Anthropic SSE mock, `live/` (`@live` specs)
- `scripts/` — `e2e-vercel.sh`, `gen-fixture.ts`, `load-env.ts`, `vite-api-plugin.ts`
- `src/` — `app/` (router, providers, theme, debug hook), `routes/`
  (file-based), `lib/`, `styles/` + `ui/`, `db/`, `llm/` + `fixtures/`,
  `features/` — see docs/plans/P0.md §3
- `docs/plans/` — as-built plan records (`P0.md`); see `PLAN.MD` for P1
- `public/` — static assets (favicon)

## Hard rules

1. `src/db/repo.ts` is the only write path to IndexedDB — no component or
   hook writes to Dexie tables directly.
2. Never call the real Anthropic API from any test; route
   `api.anthropic.com` must always be mocked in e2e.
3. Never run `vercel --prod` or `vercel deploy --prod`; never push to
   `main`; never set `ALLOW_TEST_MODE` or `MODEL_PROVIDER=fake` in the
   `production` Vercel environment.
4. No semicolons, single quotes, Prettier decides everything else
   (`semi: false, singleQuote: true, trailingComma: 'all'`).
5. No `enum` (use `as const` unions); use `import type` for type-only
   imports (`erasableSyntaxOnly` + `verbatimModuleSyntax`).
6. Components use semantic CSS tokens from `src/styles/tokens.css` only —
   never reference Radix color vars directly.
7. Never pass `thinking` or `temperature` to `messages.stream` (adaptive
   thinking is the default on Opus 5 / Sonnet 5).
8. Bump `PROMPT_VERSION` and regenerate the fixture whenever the system
   prompt or schema changes.
9. Commit after every verified task; push only once the full gate
   (`pnpm check && pnpm test && pnpm test:e2e`, then `pnpm test:e2e:vercel`)
   is green — a push always creates at least a Git preview.
10. Never merge or touch `main`; secrets live only in Vercel env and the
    gitignored `.env.local` / `.env.development.local`; all Blob access
    goes through `api/_lib/store` with `useCache: false`.

## Rule files

| File                       | Applies to                                                                         | Covers                                                        |
| -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `.claude/rules/api.md`     | `api/**`, `scripts/vite-api-plugin.ts`, `scripts/load-env.ts`, `tsconfig.api.json` | Handler shape, routing, imports, BlobStore, env vars, secrets |
| `.claude/rules/ui.md`      | `src/ui/**`, `src/features/**`, `src/styles/**`, `src/routes/**`                   | Base UI wrappers, tokens, Thai typography, tone colors        |
| `.claude/rules/data.md`    | `src/db/**`, `src/lib/**`                                                          | Dexie schema, migrations, sync invariants, snapshot format    |
| `.claude/rules/llm.md`     | `src/llm/**`, `scripts/gen-fixture.ts`, `src/fixtures/**`                          | Model IDs, structured outputs, caching, prompt versioning     |
| `.claude/rules/testing.md` | `e2e/**`, `**/*.test.ts`, `playwright.config.ts`, `vitest.config.ts`               | Mock contract, seeding, speed budget, Vercel runs             |
| `.claude/rules/deploy.md`  | `vercel.json`, `scripts/**`, `.env*`, `api/_lib/env.ts`                            | Git-connected reality, env vars, Blob stores, bypass secret   |

See `PLAN.MD` for the current (P1) plan and `docs/plans/P0.md` for the
as-built P0 record.
