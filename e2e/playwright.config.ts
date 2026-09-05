import { defineConfig, devices } from '@playwright/test'

const CI = !!process.env.CI

// Every spec talks to `apps/api/src/local.ts` (in-memory store, fake model)
// through `apps/web`'s built-and-served preview, so a run never touches
// production data no matter what `pnpm dev:prod` is doing elsewhere.
export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // `start`, not `dev`: `dev` runs under `tsx watch`, and a file save
      // mid-run would restart the process and wipe the in-memory store out
      // from under whatever tests are mid-flight.
      command: 'pnpm --filter api start',
      cwd: '..',
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: !CI,
      env: { FAKE_MODEL_DELAY_MS: '500' },
    },
    {
      // The suite runs against `preview`, not `dev`: the service worker is
      // only registered against a build, and offline behavior is the point.
      // Locally there's no separate build step, so build first; CI builds
      // the app in its own step before this config ever runs.
      command: CI
        ? 'pnpm --filter web preview --strictPort'
        : 'pnpm --filter web build && pnpm --filter web preview --strictPort',
      cwd: '..',
      url: 'http://localhost:4173',
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
  ],
})
