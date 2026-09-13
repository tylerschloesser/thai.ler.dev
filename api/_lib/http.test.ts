import { describe, expect, it } from 'vitest'
import { fail, failFromError, HttpError, json } from './http.js'
import { StoreSuspendedError } from './store/index.js'

/**
 * `failFromError` (PLAN.MD §5 M5, §9 risks): every `api/**` handler's
 * top-level `try/catch` funnels through this one function, so teaching it
 * to recognize `StoreSuspendedError` (thrown by `api/_lib/store/vercel.ts`
 * when the Hobby Blob store is suspended for the month) is enough for every
 * handler to answer with a readable `fail('store', ...)` toast, with no
 * per-handler change needed.
 */
describe('failFromError', () => {
  it('maps an HttpError to its own kind and message', async () => {
    const res = failFromError(new HttpError('not_found', 'no such dialogue'))
    expect(res.status).toBe(404)
    const body = (await res.json()) as {
      error: { kind: string; message: string }
    }
    expect(body.error).toEqual({
      kind: 'not_found',
      message: 'no such dialogue',
    })
  })

  it('maps StoreSuspendedError to a readable store-kind fail response', async () => {
    const res = failFromError(new StoreSuspendedError())
    expect(res.status).toBe(502)
    const body = (await res.json()) as {
      error: { kind: string; message: string }
    }
    expect(body.error.kind).toBe('store')
    expect(body.error.message).toMatch(/suspended/i)
    expect(body.error.message).toMatch(/quota resets/i)
    expect(body.error.message).toMatch(/offline/i)
  })

  it('maps an unrelated error to internal with its message', async () => {
    const res = failFromError(new Error('boom'))
    expect(res.status).toBe(500)
    const body = (await res.json()) as {
      error: { kind: string; message: string }
    }
    expect(body.error).toEqual({ kind: 'internal', message: 'boom' })
  })
})

describe('json / fail', () => {
  it('always sets cache-control: private, no-store', () => {
    const res = json({ ok: true })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(fail('busy', 'nope').headers.get('cache-control')).toBe(
      'private, no-store',
    )
  })
})
