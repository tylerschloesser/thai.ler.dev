import { describe, expect, it } from 'vitest'
import { HttpError } from './http.js'
import { requireInternalSecret } from './internalAuth.js'

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/annotation/step', {
    method: 'POST',
    headers,
  })
}

describe('requireInternalSecret', () => {
  it('passes when the header matches exactly', () => {
    expect(() =>
      requireInternalSecret(
        request({ 'x-thai-internal': 'super-secret' }),
        'super-secret',
      ),
    ).not.toThrow()
  })

  it('throws unauthorized when the header is missing', () => {
    expect(() => requireInternalSecret(request(), 'super-secret')).toThrow(
      HttpError,
    )
  })

  it('throws unauthorized when expected is undefined (no INTERNAL_SECRET configured)', () => {
    expect(() =>
      requireInternalSecret(
        request({ 'x-thai-internal': 'anything' }),
        undefined,
      ),
    ).toThrow(HttpError)
  })

  it('throws unauthorized when the header value differs', () => {
    expect(() =>
      requireInternalSecret(
        request({ 'x-thai-internal': 'wrong' }),
        'super-secret',
      ),
    ).toThrow(HttpError)
  })

  it('throws unauthorized (not a timingSafeEqual RangeError) when lengths differ', () => {
    expect(() =>
      requireInternalSecret(
        request({ 'x-thai-internal': 'short' }),
        'a-much-longer-secret',
      ),
    ).toThrow(HttpError)
  })

  it('the thrown error has kind "unauthorized"', () => {
    try {
      requireInternalSecret(request(), 'super-secret')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError)
      expect((err as HttpError).kind).toBe('unauthorized')
    }
  })
})
