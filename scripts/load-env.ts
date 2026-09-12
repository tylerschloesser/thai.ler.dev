import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Shared `.env.*` reader for local development (`scripts/vite-api-plugin.ts`)
 * and `playwright.config.ts` (PLAN.MD §4.7). Reads `.env.development.local`
 * then `.env.local` from `dir` (default: cwd) into `process.env`, without
 * ever overriding a key that's already set - the shell always wins, and a
 * key from `.env.development.local` wins over the same key in `.env.local`.
 * Never logs a value.
 *
 * `vercel link` / `vercel env pull` write these files, and they typically
 * include Vercel/CI system vars (`VERCEL=1`, `VERCEL_ENV`,
 * `VERCEL_TARGET_ENV`, `VERCEL_URL`, `VERCEL_GIT_*`, `TURBO_*`,
 * `NX_DAEMON`) that must never leak into a plain local Node process -
 * `api/_lib/env.ts` reads `process.env.VERCEL` to decide whether it's
 * running on Vercel (which flips the `BLOB_BACKEND`/`INTERNAL_SECRET`
 * defaults), and `api/_lib/hop.ts` (M1) reads `VERCEL_URL` as the
 * continuation hop's target. So every `VERCEL_*` key is skipped here
 * except the two this repo's tooling actually needs locally:
 * `VERCEL_AUTOMATION_BYPASS_SECRET` (Playwright, to reach a real preview)
 * and `VERCEL_OIDC_TOKEN` (the `vercel` blob backend, if used locally).
 */

const SKIP_PREFIXES = ['VERCEL_', 'TURBO_']
const SKIP_EXACT = new Set(['VERCEL', 'NX_DAEMON'])
const NEVER_SKIP = new Set([
  'VERCEL_AUTOMATION_BYPASS_SECRET',
  'VERCEL_OIDC_TOKEN',
])

function shouldSkip(key: string): boolean {
  if (NEVER_SKIP.has(key)) return false
  if (SKIP_EXACT.has(key)) return true
  return SKIP_PREFIXES.some((prefix) => key.startsWith(prefix))
}

function parseDotEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

/**
 * Loads `.env.development.local` then `.env.local` from `dir` into
 * `process.env`. Both files are optional; neither is required to exist.
 */
export function loadEnv(dir: string = process.cwd()): void {
  for (const filename of ['.env.development.local', '.env.local']) {
    const file = path.join(dir, filename)
    if (!existsSync(file)) continue
    const parsed = parseDotEnv(readFileSync(file, 'utf8'))
    for (const [key, value] of Object.entries(parsed)) {
      if (shouldSkip(key)) continue
      if (process.env[key] === undefined) process.env[key] = value
    }
  }
}
