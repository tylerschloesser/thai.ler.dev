import { test, expect } from './fixtures'

/**
 * Fast, local-only checks of the M0 API scaffolding (PLAN.MD §5 M0 item 6):
 * `/api/health`'s shape, the routing spike stubs, and that unknown/`_`-
 * prefixed `/api/*` paths 404 as JSON instead of falling through to the
 * SPA's `index.html` (`vercel.json`'s rewrite excludes `/api/`, and
 * `scripts/vite-api-plugin.ts` mirrors that locally).
 */

test.describe('api-health', () => {
  test('GET /api/health', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    expect(res.headers()['cache-control']).toContain('no-store')
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      provider: 'fake',
      blobBackend: 'memory',
      testMode: true,
      sha: 'local',
      spike: { splitLines: 2 },
    })
  })

  test('unknown /api/* is a JSON 404, not the SPA fallback', async ({
    request,
  }) => {
    const res = await request.get('/api/nope')
    expect(res.status()).toBe(404)
    expect(res.headers()['content-type']).not.toContain('text/html')
    const body = await res.json()
    expect(body.error?.kind).toBe('not_found')
  })

  test('a leading-underscore segment (api/_lib/**) is not routed', async ({
    request,
  }) => {
    const res = await request.get('/api/_lib/http')
    expect(res.status()).toBe(404)
  })

  test('GET /api/annotation is the M0 routing stub', async ({ request }) => {
    const res = await request.get('/api/annotation')
    expect(res.status()).toBe(501)
    expect(await res.json()).toEqual({ stub: 'annotation' })
  })

  test('POST /api/annotation/resume is the M0 routing stub', async ({
    request,
  }) => {
    const res = await request.post('/api/annotation/resume')
    expect(res.status()).toBe(501)
    expect(await res.json()).toEqual({ stub: 'annotation/resume' })
  })
})
