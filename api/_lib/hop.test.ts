import { afterEach, describe, expect, it, vi } from 'vitest'
import { hop } from './hop.js'

const originalVercelUrl = process.env['VERCEL_URL']
const originalBypass = process.env['VERCEL_AUTOMATION_BYPASS_SECRET']

afterEach(() => {
  if (originalVercelUrl === undefined) delete process.env['VERCEL_URL']
  else process.env['VERCEL_URL'] = originalVercelUrl
  if (originalBypass === undefined)
    delete process.env['VERCEL_AUTOMATION_BYPASS_SECRET']
  else process.env['VERCEL_AUTOMATION_BYPASS_SECRET'] = originalBypass
})

describe('hop', () => {
  it('posts to origin/api/annotation/step with the internal secret header', async () => {
    delete process.env['VERCEL_URL']
    delete process.env['VERCEL_AUTOMATION_BYPASS_SECRET']
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 202 }),
    ) as unknown as typeof fetch

    const ok = await hop(
      {
        origin: 'http://localhost:4173',
        internalSecret: 'local-dev',
        testCookie: 'thai_ns=e2e-1',
        fetchImpl,
      },
      'ann-1',
    )

    expect(ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:4173/api/annotation/step?id=ann-1',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-thai-internal': 'local-dev',
          cookie: 'thai_ns=e2e-1',
        }),
      }),
    )
  })

  it('prefers VERCEL_URL over the request origin when set', async () => {
    process.env['VERCEL_URL'] = 'my-preview.vercel.app'
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }))
    await hop(
      {
        origin: 'http://localhost:4173',
        internalSecret: 'local-dev',
        testCookie: null,
        fetchImpl,
      },
      'ann-1',
    )
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://my-preview.vercel.app/api/annotation/step?id=ann-1',
      expect.anything(),
    )
  })

  it('adds the protection bypass header when VERCEL_AUTOMATION_BYPASS_SECRET is set', async () => {
    process.env['VERCEL_AUTOMATION_BYPASS_SECRET'] = 'bypass-secret'
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }))
    await hop(
      {
        origin: 'http://localhost:4173',
        internalSecret: 'x',
        testCookie: null,
        fetchImpl,
      },
      'ann-1',
    )
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-vercel-protection-bypass': 'bypass-secret',
        }),
      }),
    )
  })

  it('returns false (never throws) on a non-202 response', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }))
    const ok = await hop(
      {
        origin: 'http://localhost:4173',
        internalSecret: 'x',
        testCookie: null,
        fetchImpl,
      },
      'ann-1',
    )
    expect(ok).toBe(false)
  })

  it('returns false on Vercel recursion protection 508 INFINITE_LOOP_DETECTED (PLAN.MD §9 risks)', async () => {
    // Self-invocation past an unpublished hop count answers this specific
    // status - MAX_HOPS in runner.ts is the mitigation, but hop() itself
    // must still behave like any other non-202: never throw, just report
    // failure so the runner leaves the job visibly stalled for resume-on-
    // open (see runner.test.ts's "stalled outcome" test for that half).
    const fetchImpl = vi.fn(
      async () => new Response('INFINITE_LOOP_DETECTED', { status: 508 }),
    )
    const ok = await hop(
      {
        origin: 'http://localhost:4173',
        internalSecret: 'x',
        testCookie: null,
        fetchImpl,
      },
      'ann-1',
    )
    expect(ok).toBe(false)
  })

  it('returns false (never throws) when fetch itself throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    })
    const ok = await hop(
      {
        origin: 'http://localhost:4173',
        internalSecret: 'x',
        testCookie: null,
        fetchImpl,
      },
      'ann-1',
    )
    expect(ok).toBe(false)
  })
})
