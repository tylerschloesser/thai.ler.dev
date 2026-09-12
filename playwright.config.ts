import { defineConfig, devices } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'

// Load .env.local into process.env (if present) so VERCEL_AUTOMATION_BYPASS_SECRET
// is picked up when running against a remote Vercel preview. No dotenv dependency:
// this is a tiny inline reader. Never log the values.
function loadDotEnvLocal(path: string): void {
  if (!existsSync(path)) return
  const contents = readFileSync(path, 'utf8')
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
    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadDotEnvLocal('.env.local')

const remote = process.env.PLAYWRIGHT_BASE_URL
const baseURL = remote ?? 'http://localhost:4173'

export default defineConfig({
  testDir: 'e2e',
  // Playwright's default testMatch also claims *.test.ts, which is vitest's
  // extension. Pin it to *.spec.ts so the two runners cannot fight over a
  // file (e.g. a vitest test living next to the mock it exercises).
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  retries: remote ? 1 : 0,
  reporter: 'list',
  // Against a Vercel preview every action crosses the network and 7 workers
  // share one cold serverless edge, so UI transitions (Base UI's Select
  // popup in particular) legitimately take longer than they do locally.
  // Give remote runs more headroom rather than weakening the assertions.
  timeout: remote ? 30_000 : 15_000,
  expect: { timeout: remote ? 15_000 : 5_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    extraHTTPHeaders:
      remote && process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? {
            'x-vercel-protection-bypass':
              process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
            'x-vercel-set-bypass-cookie': 'true',
          }
        : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: remote
    ? undefined
    : {
        command: 'pnpm build && pnpm preview --port 4173 --strictPort',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
})
