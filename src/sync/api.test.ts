import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApi } from './api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('createApi', () => {
  it('parses a successful GET manifest response', async () => {
    const manifest = {
      format: 'thai.ler.dev/manifest',
      version: 1,
      updatedAt: 'x',
      entries: {},
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(manifest))
    const api = createApi(fetchImpl)

    const result = await api.getManifest()
    expect(result).toEqual(manifest)
    expect(fetchImpl).toHaveBeenCalledWith('/api/sync/manifest', undefined)
  })

  it('maps a non-ok response with an error body to ApiError', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { kind: 'not_found', message: 'no such record' } },
          404,
        ),
      )
    const api = createApi(fetchImpl)

    await expect(api.getRecord('dialogue', 'x')).rejects.toMatchObject({
      kind: 'not_found',
      message: 'no such record',
      status: 404,
    })
  })

  it('maps a thrown fetch (network failure) to an offline ApiError', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'))
    const api = createApi(fetchImpl)

    const err = await api.getManifest().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).kind).toBe('offline')
  })

  it('resumeAnnotation maps a 409 busy response to { status: "busy" } instead of throwing', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { kind: 'busy', message: 'already running' } },
          409,
        ),
      )
    const api = createApi(fetchImpl)

    const outcome = await api.resumeAnnotation('a1')
    expect(outcome).toEqual({ status: 'busy' })
  })

  it('resumeAnnotation still throws for a non-busy error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { kind: 'internal', message: 'oops' } }, 500),
      )
    const api = createApi(fetchImpl)

    await expect(api.resumeAnnotation('a1')).rejects.toMatchObject({
      kind: 'internal',
    })
  })

  // PLAN.MD §5 M5: `failFromError` (api/_lib/http.ts) maps a suspended
  // Blob store to `fail('store', <readable message>)`; this layer must
  // preserve that message verbatim so `src/features/annotate/
  // useAnnotate.ts`'s `toFriendlyError` (which passes any non-offline
  // ApiError through untouched) and `src/sync/useSync.ts`'s `lastError`
  // both show the operator-facing text, not a generic "kind: store"
  // fallback.
  it('preserves a readable store-kind error message verbatim (e.g. a suspended Blob store)', async () => {
    const message =
      'Cloud sync is paused: the Vercel Blob store is suspended until its monthly quota resets. Your library still works offline.'
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { kind: 'store', message } }, 502),
      )
    const api = createApi(fetchImpl)

    const err = await api
      .annotate({ dialogue: {} as never, model: 'claude-opus-5' })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).kind).toBe('store')
    expect((err as ApiError).message).toBe(message)
  })

  it('putRecord sends kind + record and unwraps the winner', async () => {
    const winner = { key: 'theme', value: 'dark', updatedAt: 'x' }
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ kind: 'settings', record: [winner] }))
    const api = createApi(fetchImpl)

    const result = await api.putRecord('settings', [winner])
    expect(result).toEqual([winner])
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({
      kind: 'settings',
      record: [winner],
    })
  })
})
