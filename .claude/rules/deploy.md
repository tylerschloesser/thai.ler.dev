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
to `main` **is** the production deploy. `pnpm test:e2e:vercel`
(`scripts/e2e-vercel.sh`) deploys a separate, CLI-triggered preview
(`source: "cli"`) with `vercel deploy --yes` and runs the `@live`
Playwright suite against it — the CLI never targets production; only a
Git push to `main` does. Never run `vercel --prod` or `vercel deploy
--prod` under any circumstance (the `.claude/settings.json` deny entries
for both stay in place even though deploys are Git-triggered).

Branch history: until M6 the Vercel code lived on `vercel`, while `main`
held an unrelated AWS/CDK app. Once that stack was torn down (2026-09-13),
the old `main` was tagged `archive/aws-main` (`9c57ce7`) and merged into
`vercel` with `-s ours` (`83be132`, tree unchanged), so `main`
fast-forwarded to the Vercel code without a force push. `vercel` is
retired and frozen at `83be132`. Don't push it: it would only create a
stray preview.

## Env vars per environment

| Var                               | production                         | preview                                                                           | development                                      |
| --------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| `ANTHROPIC_API_KEY`               | sensitive (M6)                     | sensitive (since 2026-09-13; deployments built earlier carry the old plain value) | shell export only                                |
| `INTERNAL_SECRET`                 | sensitive (M6)                     | sensitive                                                                         | plain                                            |
| `ALLOW_TEST_MODE`                 | **never**                          | `1` (stored sensitive by CLI default)                                             | `1` (local plugin default, not a Vercel env var) |
| `MODEL_PROVIDER`                  | unset (defaults to `anthropic`)    | unset (defaults to `anthropic`)                                                   | `anthropic` if key exported, else `fake`         |
| `BLOB_READ_WRITE_TOKEN`           | auto (`thai-ler-dev-prod`, `iad1`) | auto (`thai-ler-dev-preview`)                                                     | auto (`thai-ler-dev-preview`)                    |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | auto                               | auto                                                                              | n/a                                              |

Add or replace a value with `printf '%s' "$VALUE" | vercel env add NAME
<env> [--sensitive]`; never `echo` a secret into a command. Never set
`ALLOW_TEST_MODE` or `MODEL_PROVIDER=fake` in the `production` environment
at any milestone — `api/_lib/env.ts` refuses to start if `ALLOW_TEST_MODE`
is ever `1` with `VERCEL_ENV=production`.

## Blob store

One private store per environment pair, region `iad1`, access mode fixed
at creation: `thai-ler-dev-preview` (connected to `preview` **and**
`development`, created in M0) and `thai-ler-dev-prod` (`production`,
created in M6). All server reads pass `useCache: false`
(`.claude/rules/api.md`); nothing in the browser ever sees a Blob URL.

## Deployment Protection (Vercel Authentication)

Vercel Authentication is set to **All Deployments**
(`ssoProtection.deploymentType: "all"`) — every preview and the production
deployment alike require signing in through Vercel SSO; there is no
unauthenticated path to the app. `https://thai-ler-dev.vercel.app` (the
production alias) and `https://thai.ler.dev` (the custom domain) both
redirect to SSO for a signed-out visitor. This is what makes it safe to run
the real `anthropic` provider and a real Blob store in production on a
Hobby plan.

## Web Application Firewall (WAF)

One rate-limit rule protects `/api/*`: path starts with `/api/` **and**
method is `POST` → 60 requests / 60s per IP, fixed window, action `deny`.
Configured in the dashboard (Firewall), not in `vercel.json` — there is no
project file to keep in sync with it, just this note.

## Custom domain and DNS

`thai.ler.dev` is the production URL, added to the Vercel project with
`vercel domains add thai.ler.dev` and pointed at Vercel with a single
record in the `ler.dev` Route 53 hosted zone: `A thai 76.76.21.21`. **Never
move `ler.dev`'s nameservers to Vercel** — only the `thai` subdomain's `A`
record is Vercel's; the rest of the zone (and any other `ler.dev`
subdomains) stays on Route 53. Both `https://thai.ler.dev` and
`https://thai-ler-dev.vercel.app` resolve to the same production
deployment and sit behind Vercel Authentication — log in once per origin.

## Post-push production check

After every push to `main`, verify the deploy landed and is still gated:

```sh
curl -sI https://thai-ler-dev.vercel.app   # expect a 302 to vercel.com/sso-api
E2E_TARGET=production PLAYWRIGHT_BASE_URL=https://thai-ler-dev.vercel.app \
  pnpm exec playwright test e2e/live/health.spec.ts
```

The Playwright run needs `VERCEL_AUTOMATION_BYPASS_SECRET` exported (from
`.env.local`) to get past Vercel Authentication; see
`.claude/rules/testing.md` for what `E2E_TARGET=production` changes in the
spec's own assertions.

## Data migration (one-off, post-cutover)

Tyler's P0 library lives in the IndexedDB of whichever origin he used
before M6 (a P0 preview URL). To move it into production: Settings →
Export there, then Settings → Import once on `https://thai.ler.dev` — the
outbox pushes the imported records to Blob on the next sync. The old AWS
stack is torn down; nothing in this repo depends on it.

## The old service worker (`public/sw.js`)

The retired AWS app registered a `vite-plugin-pwa` service worker at
`/sw.js` (scope `/`) on `thai.ler.dev`. A browser that still has it keeps
serving that app's precached shell, which shows "Couldn't load your
translations." `public/sw.js` is a kill switch. On the browser's next
update check it replaces the old worker, deletes the old precache,
unregisters itself, and reloads open tabs. It never touches IndexedDB.
Keep the file at that exact path, and never register a service worker from
the current app without replacing it deliberately.
`e2e/sw-kill-switch.spec.ts` covers it.

Caveat: Vercel Authentication covers `/sw.js` too. The update check only
gets the kill switch if the browser sends a Vercel Authentication cookie
for `thai.ler.dev`. A browser whose old worker answers every navigation
may never finish the SSO login that sets that cookie, and it then gets a
`302`, the update fails, and the old worker stays. The fix there is a
manual one: DevTools → Application → Service workers → **Unregister**,
then reload.

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

Every preview and production URL sits behind Vercel Authentication.
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

## Function limit and `.vercelignore`

Hobby allows **at most 12 Serverless Functions per deployment**. Every
`.ts` file under `api/` that is not inside a `_`-prefixed directory counts,
tests included. The real routes use **11**, so a new route needs a merge
or a Pro plan. `.vercelignore` keeps `api/**/*.test.ts` out of the upload,
along with `.env*`, `.vercel`, `.data` and `.claude`. Without it the deploy
fails with "No more than 12 Serverless Functions can be added to a
Deployment on the Hobby plan". Vercel's Node builder also type-checks
`api/` without `@types/node` or strict mode and prints `TS2591` and
optional-property errors. Those errors are advisory, since the build still
completes; `tsc -b` in `pnpm check` is the real typecheck.

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
main` → the post-push production check above. Commit as soon as a task
is verified; only push once the full gate is green, since a push is now
the production deploy.
