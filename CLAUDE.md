# thai.ler.dev

An offline-first reader for Thai dialog. pnpm monorepo: `packages/schema` (`@thai/schema`,
shared zod), `apps/web` (`@thai/web`, Vite + React), `apps/api` (`@thai/api`, Hono on Lambda)
and `infra/cdk` (`@thai/cdk`, AWS CDK). `README.md` has the layout, scripts, deploy steps and
the *why* of the design. This file and `.claude/rules/` hold what must stay true.

## Context files

Area rules live in `.claude/rules/` and load only when you read a file matching their `paths`.
Planning or reviewing happens before any file is read, so **read the area's rule file first**
rather than waiting for it to load.

| Rule | Loads when you touch | Holds |
| --- | --- | --- |
| `typescript-config.md` | `tsconfig*.json`, `package.json`, `pnpm-workspace.yaml` | project references, the dependency catalog, root-only scripts |
| `web-data-layer.md` | `apps/web/src/**/*.{ts,tsx}` | TanStack DB collections, the outbox, the six rules of state |
| `web-ui.md` | `apps/web/src/**/*.{tsx,css}`, `index.html`, `vite.config.ts` | Base UI, CSS Modules, tokens, dark mode, a11y, routes, PWA |
| `schema.md` | `packages/schema/**`, `apps/api/src/normalize.ts` | shared zod, what a client may write |
| `api.md` | `apps/api/**`, `infra/cdk/lib/api.ts` | auth seam, key shapes, idempotency, worker timeouts, sync |
| `cdk.md` | `infra/cdk/**`, `.github/workflows/**` | stacks, the CloudFront gotchas, AWS access, secrets |
| `testing.md` | `e2e/**`, `apps/api/src/local.ts` and its fixtures/fake model/memory store | the Playwright e2e suite, the fake-model contract, selector gotchas |

Skills: `file-issue` turns a side finding into a deduped GitHub issue; `/research-issue` turns
a topic into an executable spec issue; `verify-offline` walks the five browser-only checks;
`playwright-cli` drives the browser.

## Always true

- **`pnpm dev` runs the API in-process** (`apps/api/src/local.ts` — memory store, fake model,
  `x-id-token` user) alongside the web app, so nothing local touches production.
  `pnpm dev:prod` (or `API_TARGET=https://thai.ler.dev`) proxies to the deployed API and
  reads and writes **production data**.
- Dependency versions live in the `catalog:` block of `pnpm-workspace.yaml`. Manifests say
  `"catalog:"`, never a semver range.
- `erasableSyntaxOnly` and `verbatimModuleSyntax` are on: no `enum`, no constructor parameter
  properties (assign fields in the body), and `import type` for types.
- No formatter. Match the surrounding style: no semicolons, single quotes.
- **There is no unit-test framework**, and `pnpm lint && pnpm typecheck && pnpm build` cannot
  fail for any behaviour this app exists for: the offline paths only break in a real browser.
  `pnpm test:e2e` (Playwright, `testing.md`) is what covers them, and CI runs it — `ci.yml` on
  every PR, `deploy.yml` after build and before it touches AWS. It still isn't everything;
  `verify-offline` covers what only a human can eyeball. Run both after touching
  `apps/web/src/db/` or the service worker.
- Deploy by naming the stacks; the root `pnpm deploy` is ambiguous across three:
  `pnpm build && AWS_PROFILE=admin pnpm --filter cdk exec cdk deploy ThaiLerDevSharedStack
  ThaiLerDevSiteStack`. A fourth, `ThaiLerDevPreview<n>Stack`, exists only when
  `-c pr=<n> -c preview=frontend|full-stack` is passed.

## How to work

Plan every non-trivial task as chunks that a cheaper model implements and a *different*
cheaper model verifies, so the expensive model spends its context on judgment, not typing.

- A chunk is small enough to carry a **one-line acceptance check** that someone with no
  conversation context could run: a lint/typecheck pass, a `verify-offline` walk, a grep that
  proves an invariant. If you cannot write the check, the chunk is not specified yet.
- Delegate implementation to the `implementer` agent and the check to the `verifier` agent
  (`.claude/agents/`, both pinned to sonnet). The verifier gets the chunk and its check, never
  the implementer's reasoning, and reports PASS/FAIL with evidence without fixing anything.
  For a shape neither fits, use the Agent tool with `model: sonnet`.
- Keep the expensive model for decomposition, judgment calls, anything that touches an
  invariant named in a rule file, and the review of the integrated diff.
- Don't delegate a chunk smaller than its handoff (a one-line edit), or one that only makes
  sense with the whole conversation in view.
- A problem you notice that the task doesn't cover is neither fixed nor dropped: run
  `file-issue` (it dedupes, then files with the `claude` label), put the URL in your report,
  carry on.
- Work moves between local sessions and GitHub issues. An issue is picked up either by a
  claude.ai/code session or by an `@claude` comment (the GitHub Action in
  `.github/workflows/claude.yml`), so it must stand alone: symptom, where, acceptance check,
  out of scope. **Never write `@claude` into an issue body**; that starts a run.

## Keeping this context current

These files are a contract with the next session, and a false claim is worse than a missing
one: an agent reading it literally will "fix" working code.

- Include what is load-bearing and not derivable from the code; leave out what the code
  already says well. Prefer pointing at a comment in the code to restating it
  (`apps/api/tsconfig.json`, the root `package.json` `"//"` key and `.vscode/settings.json`
  already carry theirs).
- A change that invalidates a claim in any rule fixes the rule **in the same commit**.
- When something costs a debugging session and isn't obvious from the code, add it to the
  matching rule. If no rule fits, add one and a row to the table above. When a concrete
  pointer goes stale, rewrite it as a forward-looking rule rather than deleting it.
- Retire content the code now makes obvious. Budgets: this file under 100 lines, each rule
  under about 120. Keep `paths` globs literal where you can; brace groups share a
  1,000-pattern budget per rule.
- `README.md` is the narrative for people; the rules are constraints for agents. Say a thing
  in one of them and point at it from the other.
- `/context` lists which memory files loaded. Use it to confirm a rule fires when expected.
