import { test, expect } from '../fixtures'

/**
 * `@live`: runs only against a real Vercel preview via
 * `scripts/e2e-vercel.sh` (`pnpm test:e2e:vercel`), never locally
 * (`playwright.config.ts` sets `grepInvert: /@live/` when
 * `PLAYWRIGHT_BASE_URL` isn't set). Exercises the real runtime: the
 * `vercel` Blob backend, `/api/annotation` and `/api/annotation/step`
 * coexisting as separate routes with real (not M0-stub) behaviour, and the
 * SPA rewrite for a deep link (PLAN.MD §4.8, §5 M0/M1).
 *
 * `E2E_TARGET=production` (env var, default `preview`): after the M6
 * cutover this same spec also runs against
 * `https://thai-ler-dev.vercel.app` with `ALLOW_TEST_MODE` unset
 * (PLAN.MD §4.8 "Against production ... only live/health is meaningful",
 * §4.10). On production `/api/health` reports `testMode: false` and the
 * real `provider`/`blobBackend`, and the `ALLOW_TEST_MODE`-gated test-only
 * routes (`POST /api/test/seed`, `DELETE /api/test/namespace`) must 404 -
 * this spec never seeds or annotates against production, so it creates no
 * data there. `e2e/fixtures.ts`'s `context` teardown still fires its
 * `DELETE /api/test/namespace?ns=` unconditionally; it isn't `await`ed
 * against `res.ok()` there, so that 404 on production doesn't fail the
 * test.
 */

const isProduction = process.env.E2E_TARGET === 'production'

test.describe('live/health', () => {
  test(
    `GET /api/health on a real ${isProduction ? 'production' : 'preview'} deployment`,
    { tag: '@live' },
    async ({ request }, testInfo) => {
      const res = await request.get('/api/health')
      expect(res.status()).toBe(200)
      expect(res.headers()['cache-control']).toContain('no-store')
      const body = await res.json()
      expect(body).toMatchObject(
        isProduction
          ? {
              ok: true,
              provider: 'anthropic',
              blobBackend: 'vercel',
              testMode: false,
              spike: { splitLines: 2 },
            }
          : {
              ok: true,
              blobBackend: 'vercel',
              testMode: true,
              spike: { splitLines: 2 },
            },
      )
      expect(typeof body.spike.hasDeadline).toBe('boolean')
      testInfo.annotations.push({
        type: 'spike.hasDeadline',
        description: String(body.spike.hasDeadline),
      })
    },
  )

  test(
    '/api/annotation and /api/annotation/step coexist, and both answer real behaviour',
    { tag: '@live' },
    async ({ request }) => {
      const get = await request.get('/api/annotation?id=missing')
      expect(get.status()).toBe(404)
      expect((await get.json()).error?.kind).toBe('not_found')

      const post = await request.post('/api/annotation/step?id=missing')
      expect(post.status()).toBe(401)
    },
  )

  test(
    'unknown /api/* is a JSON 404 on the real deployment too',
    { tag: '@live' },
    async ({ request }) => {
      const res = await request.get('/api/nope')
      expect(res.status()).toBe(404)
      expect(res.headers()['content-type']).not.toContain('text/html')
    },
  )

  test(
    'the SPA rewrite serves a deep link',
    { tag: '@live' },
    async ({ page }) => {
      await page.goto('/settings')
      await expect(
        page.getByRole('heading', { name: 'Settings' }),
      ).toBeVisible()
    },
  )

  test(
    'test-only routes are disabled without ALLOW_TEST_MODE (production)',
    { tag: '@live' },
    async ({ request }) => {
      test.skip(!isProduction, 'preview runs with ALLOW_TEST_MODE=1')

      // No data is created: createContext's testMode check runs before
      // either handler reads its body/params, so this always short-circuits
      // to a 404 - never a seed write or a namespace delete.
      const seed = await request.post('/api/test/seed', { data: {} })
      expect(seed.status()).toBe(404)

      const ns = await request.delete('/api/test/namespace?ns=x')
      expect(ns.status()).toBe(404)
    },
  )
})
