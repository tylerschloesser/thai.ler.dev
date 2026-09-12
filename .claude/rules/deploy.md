---
paths:
  - 'vercel.json'
  - 'scripts/**'
  - '.env*'
  - 'api/_lib/env.ts'
---

# Deploy rules

## Git-connected reality

The Vercel project (`thai-ler-dev`, `prj_mZ6rdu95y6OVvaHsmqpDkibFXKIv`,
team `team_4mFhw0OaMx19wdVvfq9sEZuX`) is Git-connected to
`tylerschloesser/thai.ler.dev` with production branch **`main`** — a push
to `vercel` creates a Git-triggered preview (`source: "git"`), never a
production deploy, as long as `main` never receives pushes (hard rule 10).
`pnpm test:e2e:vercel` (`scripts/e2e-vercel.sh`) deploys a separate,
CLI-triggered preview (`source: "cli"`) with `vercel deploy --yes` and runs
the `@live` Playwright suite against it. Production is not deployed at all
until M6, when Tyler switches the dashboard's production branch to
`vercel` — from that point on, a push to `vercel` **is** the production
deploy. Never run `vercel --prod` or `vercel deploy --prod` under any
circumstance, and never push to `main`.

## Env vars per environment (as of M0)

| Var                               | production | preview                                                            | development                                      |
| --------------------------------- | ---------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| `ANTHROPIC_API_KEY`               | unset      | plain (P0 var; becomes sensitive when Tyler provides the real key) | shell export only                                |
| `INTERNAL_SECRET`                 | unset      | sensitive                                                          | plain                                            |
| `ALLOW_TEST_MODE`                 | **never**  | `1` (stored sensitive by CLI default)                              | `1` (local plugin default, not a Vercel env var) |
| `BLOB_READ_WRITE_TOKEN`           | unset      | auto (`thai-ler-dev-preview`)                                      | auto (`thai-ler-dev-preview`)                    |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | auto       | auto                                                               | n/a                                              |

Add or replace a value with `printf '%s' "$VALUE" | vercel env add NAME
<env> [--sensitive]`; never `echo` a secret into a command, and never add
anything to `production` before M6. Never set `ALLOW_TEST_MODE` or
`MODEL_PROVIDER=fake` in the `production` environment at any milestone.

## Blob store

One private store per environment pair, region `iad1`, access mode fixed
at creation: `thai-ler-dev-preview` (connected to `preview` **and**
`development`, created in M0) and `thai-ler-dev-prod` (`production`,
created in M6). All server reads pass `useCache: false`
(`.claude/rules/api.md`); nothing in the browser ever sees a Blob URL.

## `.env*` file rules

`.env.local` and `.env.development.local` are both gitignored (`.env*`)
and both denied to `Read` by `.claude/settings.json` — never read, print,
or write either file. `vercel link --yes` **creates** `.env.local` (it
pulls the `development` environment), and `vercel blob create-store
--environment development` / `vercel env add … development` **update** it
again — so the file existing proves nothing about whether the bypass
secret is in it; check before linking, not after. `vercel env pull` only
ever writes to an explicit, non-`.env.local` filename:

```sh
vercel env pull .env.development.local --environment=development
```

Never run a bare `vercel env pull` (it would target `.env.local` and wipe
the bypass secret without restoring it — `vercel env pull` doesn't fetch
that secret at all). `scripts/load-env.ts` reads `.env.development.local`
then `.env.local`, never overrides an already-set shell var, never logs a
value, and skips `VERCEL`/every `VERCEL_*` key (except
`VERCEL_AUTOMATION_BYPASS_SECRET` and `VERCEL_OIDC_TOKEN`) plus
`TURBO_*`/`NX_DAEMON`, so a local process never mistakes itself for a
Vercel runtime.

## Protection bypass secret

Preview and (once deployed) production URLs sit behind Vercel Authentication.
`VERCEL_AUTOMATION_BYPASS_SECRET` lives only in the gitignored `.env.local`
and lets `scripts/e2e-vercel.sh` / Playwright reach a preview with the
`x-vercel-protection-bypass` header. Verify it still matches the project
with:

```sh
vercel api "/v9/projects/prj_mZ6rdu95y6OVvaHsmqpDkibFXKIv?teamId=team_4mFhw0OaMx19wdVvfq9sEZuX"
```

and compare the `protectionBypass` value — **not** `vercel env pull`, which
never writes this secret and would silently leave `.env.local` without it.
If it's ever missing or stale, ask Tyler to regenerate it in the dashboard
(Settings → Deployment Protection → Protection Bypass for Automation)
rather than trying to recreate it from the CLI. For a one-off check against
a specific deployment, `vercel curl <path> --deployment <url>` (beta, CLI
59.16.0) adds the protection bypass itself and needs no `.env.local` at
all — Playwright still needs `VERCEL_AUTOMATION_BYPASS_SECRET` exported.

## Getting a preview URL

CLI 59.16.0's `vercel deploy --yes` still prints a pretty-printed JSON
envelope to a non-TTY stdout (containing a `"url"` field) rather than a
bare URL. `scripts/e2e-vercel.sh` parses that JSON out of stdout, with a
regex fallback for a bare `https://*.vercel.app` string in case a future
CLI version changes the shape again. Don't assume a plain URL comes back
from piping or capturing `vercel deploy` output — check the actual stdout
shape first. Report the resolved URL back after any deploy-verification
step.

## Per-milestone flow

`pnpm check && pnpm test && pnpm test:e2e` green → commit → `pnpm
test:e2e:vercel` (CLI preview + `@live` suite) green → `git push origin
vercel`. Do the full gate at least at the end of every milestone (M0, M1,
M4, M5, M6 per PLAN.MD §5 at minimum); commit as soon as a task is verified
but only push once the full gate is green, since a push always creates at
least a Git preview today and will be a production deploy after M6.
