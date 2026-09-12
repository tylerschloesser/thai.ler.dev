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
