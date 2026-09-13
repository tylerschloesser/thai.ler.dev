#!/usr/bin/env sh
# Deploy a CLI PREVIEW (never --prod: production is deployed only by the
# Git push after the M6 cutover) and run the @live Playwright specs against it.
set -eu

# VERCEL_AUTOMATION_BYPASS_SECRET lives here. `vercel env pull` does NOT
# write it, so never "fix" a missing secret by pulling.
set -a
[ -f .env.local ] && . ./.env.local
set +a

raw=$(vercel deploy --yes)

# Vercel CLI 56.x-59.x prints a JSON envelope on stdout when stdout is not a TTY;
# other versions print the bare URL. Handle both.
url=$(printf '%s\n' "$raw" | sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\(https:\/\/[^"]*\)".*/\1/p' | head -n 1)
[ -n "$url" ] || url=$(printf '%s\n' "$raw" | grep -o 'https://[^"[:space:]]*\.vercel\.app' | head -n 1)
[ -n "$url" ] || {
  echo "e2e-vercel: could not parse a deployment URL from vercel deploy output:" >&2
  printf '%s\n' "$raw" >&2
  exit 1
}

echo "Preview: $url"
PLAYWRIGHT_BASE_URL="$url" pnpm exec playwright test --grep @live "$@"
echo "Reminder: note Blob usage (Storage → thai-ler-dev-preview → Usage) in the commit body."
