import { test, expect } from '../fixtures'

/**
 * `@live`: runs only against a real Vercel preview via
 * `scripts/e2e-vercel.sh` (`pnpm test:e2e:vercel`), never locally
 * (`playwright.config.ts` sets `grepInvert: /@live/` when
 * `PLAYWRIGHT_BASE_URL` isn't set). Exercises the real runtime: the
 * `vercel` Blob backend, `/api/annotation` and `/api/annotation/step`
 * coexisting as separate routes with real (not M0-stub) behaviour, and the
 * SPA rewrite for a deep link (PLAN.MD §4.8, §5 M0/M1).
 */

test.describe('live/health', () => {
  test(
    'GET /api/health on a real preview',
    { tag: '@live' },
    async ({ request }, testInfo) => {
      const res = await request.get('/api/health')
      expect(res.status()).toBe(200)
      expect(res.headers()['cache-control']).toContain('no-store')
      const body = await res.json()
      expect(body).toMatchObject({
        ok: true,
        blobBackend: 'vercel',
        testMode: true,
        spike: { splitLines: 2 },
      })
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
})
