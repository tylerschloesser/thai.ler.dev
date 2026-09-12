# thai.ler.dev

A personal Thai-learning web app: paste a dialogue, run it through Claude,
and get a layered annotation (dialogue → line → sentence → word → syllable)
with romanization, gloss, tone, and learner notes. Everything is stored
client-side in IndexedDB; the Anthropic call is made directly from the
browser to a Vercel preview deployment (never production).

**Stack**: Vite + React 19 + TypeScript, Base UI + CSS Modules + Radix
Colors, TanStack Router/Query/Form, Dexie (IndexedDB), `@anthropic-ai/sdk`,
Vitest + Playwright, deployed via the Vercel CLI (preview only).

## Commands

- `pnpm dev` — local dev server
- `pnpm build` — typecheck + production build
- `pnpm preview` — serve the production build
- `pnpm check` — lint + typecheck + format:check (run before every commit)
- `pnpm test` — Vitest unit tests
- `pnpm test:e2e` — Playwright against local `vite preview`
- `pnpm test:e2e:vercel` — deploy a preview and run Playwright against it
- `pnpm deploy:preview` — `vercel deploy --yes` (preview only)
- `pnpm gen:fixture` — regenerate `src/fixtures/sample.annotation.json`

## Layout

- `.claude/` — context engineering: rules, agents, permissions
- `e2e/` — Playwright specs + fixtures; Anthropic SSE mock lands in M3
- `scripts/` — `e2e-vercel.sh`; `gen-fixture.ts` lands in M3
- `src/` — `app/` (router, providers), `routes/` (file-based), `lib/`;
  `styles/` + `ui/` (M1), `db/` (M2), `llm/` + `fixtures/` (M3),
  `features/` (M4) — see PLAN.MD §3
- `public/` — static assets (favicon)

## Hard rules

1. `src/db/repo.ts` is the only write path to IndexedDB — no component or
   hook writes to Dexie tables directly.
2. Never call the real Anthropic API from any test; route
   `api.anthropic.com` must always be mocked in e2e.
3. Never run `vercel --prod` or `vercel deploy --prod` — the production
   alias is public and the API key ships in the client bundle.
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
9. Commit and push after every green milestone (`pnpm check && pnpm test &&
pnpm test:e2e` passing) — don't wait until a whole milestone finishes.
10. Never merge or touch `main` — `vercel` is a clean-restart branch.

## Rule files

| File                       | Applies to                                                           | Covers                                                     |
| -------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| `.claude/rules/ui.md`      | `src/ui/**`, `src/features/**`, `src/styles/**`, `src/routes/**`     | Base UI wrappers, tokens, Thai typography, tone colors     |
| `.claude/rules/data.md`    | `src/db/**`, `src/lib/**`                                            | Dexie schema, migrations, sync invariants, snapshot format |
| `.claude/rules/llm.md`     | `src/llm/**`, `scripts/gen-fixture.ts`, `src/fixtures/**`            | Model IDs, structured outputs, caching, prompt versioning  |
| `.claude/rules/testing.md` | `e2e/**`, `**/*.test.ts`, `playwright.config.ts`, `vitest.config.ts` | Mock contract, seeding, speed budget, Vercel runs          |
| `.claude/rules/deploy.md`  | `vercel.json`, `scripts/**`, `.env*`                                 | Preview-only policy, env vars, bypass secret               |

See `PLAN.MD` for the full plan, architecture, and milestone status.
