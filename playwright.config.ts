import { defineConfig, devices } from '@playwright/test'
import { loadEnv } from './scripts/load-env.ts'

// Load .env.local (then .env.development.local, if present) into
// process.env so VERCEL_AUTOMATION_BYPASS_SECRET is picked up when running
// against a remote Vercel preview. Shared with scripts/vite-api-plugin.ts;
// never logs values, never overrides an already-set key.
loadEnv()

const remote = process.env.PLAYWRIGHT_BASE_URL
const baseURL = remote ?? 'http://localhost:4173'

export default defineConfig({
  testDir: 'e2e',
  // Playwright's default testMatch also claims *.test.ts, which is vitest's
  // extension. Pin it to *.spec.ts so the two runners cannot fight over a
  // file (e.g. a vitest test living next to the mock it exercises).
  testMatch: '**/*.spec.ts',
  // e2e/live/**/*.spec.ts specs are tagged @live (PLAN.MD §4.8) and only
  // run against a real Vercel preview via scripts/e2e-vercel.sh
  // (PLAYWRIGHT_BASE_URL set). Exclude them from the local fast suite so
  // `pnpm test:e2e` never tries to hit a preview deployment.
  grepInvert: remote ? undefined : /@live/,
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
        env: {
          BLOB_BACKEND: 'memory',
          MODEL_PROVIDER: 'fake',
          ALLOW_TEST_MODE: '1',
          STEP_BUDGET_MS: '250000',
        },
      },
})
