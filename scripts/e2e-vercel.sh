#!/usr/bin/env sh
set -eu
set -a; [ -f .env.local ] && . ./.env.local; set +a
url=$(vercel deploy --yes)            # preview only; never --prod
echo "Preview: $url"
PLAYWRIGHT_BASE_URL="$url" pnpm exec playwright test "$@"
