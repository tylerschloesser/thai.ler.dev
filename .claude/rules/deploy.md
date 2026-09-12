---
paths:
  - 'vercel.json'
  - 'scripts/**'
  - '.env*'
---

# Deploy rules

## Preview-only, always

This project deploys to Vercel via the CLI (the repo is CLI-linked, not
Git-connected). The production alias `thai-ler-dev.vercel.app` is
**public**, and the Anthropic API key ships in the client bundle — so
**never** run `vercel --prod` or `vercel deploy --prod`, and never add
secrets to the `production` environment. `pnpm deploy:preview` (`vercel
deploy --yes`) is the only sanctioned deploy command, and it targets
preview by default.

## Env vars

`ANTHROPIC_API_KEY` is set on the Vercel project's `preview` environment
only, via:

```sh
printf '%s' "$ANTHROPIC_API_KEY" | vercel env add ANTHROPIC_API_KEY preview
```

Never print the key, and never add it to `production`.

## Protection bypass secret

Preview (and production) `*.vercel.app` URLs sit behind Vercel SSO
(Standard Protection). `VERCEL_AUTOMATION_BYPASS_SECRET` lives only in the
gitignored `.env.local` and lets `scripts/e2e-vercel.sh` / Playwright reach
the preview with a `x-vercel-protection-bypass` header.

Verify it still matches the project with:

```sh
vercel api "/v9/projects/prj_mZ6rdu95y6OVvaHsmqpDkibFXKIv?teamId=team_4mFhw0OaMx19wdVvfq9sEZuX"
```

and compare the `protectionBypass` value — **not** `vercel env pull`, which
only writes system/git-scoped env vars and omits this secret entirely; running
it would silently overwrite `.env.local` without the bypass secret. If the
secret is ever missing or stale, ask Tyler to regenerate it in the
dashboard (Settings → Deployment Protection → Protection Bypass for
Automation) rather than trying to recreate it from the CLI.

## Getting a preview URL

CLI 56.4.1 does not print a bare URL to a pipe — when stdout isn't a TTY,
`vercel deploy --yes` prints a JSON envelope containing a `"url"` field
instead. `scripts/e2e-vercel.sh` parses that JSON out of stdout (with a
regex fallback for a bare `https://*.vercel.app` URL, in case a future CLI
version changes back). Don't assume a plain URL comes back from piping or
capturing `vercel deploy` output — check the actual stdout shape first.
Report the resolved URL back after any deploy-verification step.

## Per-milestone flow

`pnpm check && pnpm test && pnpm test:e2e` green → commit → `git push origin
vercel` → `pnpm test:e2e:vercel` (deploys a fresh preview and runs the full
suite against it). Do this at least at the end of M0, M4, and M5.
