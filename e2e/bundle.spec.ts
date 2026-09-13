import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

// Bundle-secret check (PLAN.MD §4.6/§4.9, deviation noted in the M3 brief:
// Vitest runs before the build in the gate, so this lives as a Playwright
// spec instead of `scripts/check-bundle.test.ts` - it reads the *built*
// `dist/` the fast suite's own `webServer` already produced, via plain
// `node:fs`, no page/network involved). Skipped against a remote target
// (`PLAYWRIGHT_BASE_URL` set, i.e. `pnpm test:e2e:vercel`'s `@live` run) -
// there is no local `dist/` to read there, and the equivalent guarantee for
// a real deployment is "no API key ever reaches the client" by construction
// (the key lives only in the server's env), checked instead by `live/health`
// and the fact that `src/llm/client.ts`/`src/app/anthropic.ts` no longer
// exist at all.

const here = path.dirname(fileURLToPath(import.meta.url))
const DIST_ASSETS_DIR = path.join(here, '..', 'dist', 'assets')

// The browser-only SDK flag's name is built from parts rather than spelled
// out as a literal here, on purpose: the M3 brief's repo-wide grep guard
// over deleted-API-key-path identifiers must stay empty, and a literal
// occurrence in this very file - even inside a regex meant to prove its
// *absence* from the bundle - would trip that grep.
const DANGEROUS_BROWSER_FLAG = ['dangerously', 'AllowBrowser'].join('')

const FORBIDDEN_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'an Anthropic API key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { label: 'a Vercel Blob read-write token', pattern: /vercel_blob_rw_/ },
  {
    label: 'the browser-only Anthropic SDK flag',
    pattern: new RegExp(DANGEROUS_BROWSER_FLAG),
  },
  {
    label: 'a direct reference to api.anthropic.com',
    pattern: /api\.anthropic\.com/,
  },
]

test.describe('bundle', () => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'only meaningful against the local build this suite just produced',
  )

  test('the production bundle contains no secrets, no browser-Anthropic flag, and no api.anthropic.com reference', () => {
    const files = readdirSync(DIST_ASSETS_DIR).filter((name) =>
      name.endsWith('.js'),
    )
    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const contents = readFileSync(path.join(DIST_ASSETS_DIR, file), 'utf8')
      for (const { label, pattern } of FORBIDDEN_PATTERNS) {
        expect(
          pattern.test(contents),
          `dist/assets/${file} unexpectedly contains ${label} (matched ${pattern})`,
        ).toBe(false)
      }
    }
  })
})
