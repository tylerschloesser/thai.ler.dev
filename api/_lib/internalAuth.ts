import { timingSafeEqual } from 'node:crypto'
import { HttpError } from './http.js'

/**
 * Guards `POST /api/annotation/step` (PLAN.MD §4.6): the hop's
 * `x-thai-internal` header must match `INTERNAL_SECRET` exactly, compared
 * with `crypto.timingSafeEqual` (never `===`) to avoid a timing side
 * channel. `timingSafeEqual` throws on a length mismatch rather than
 * returning `false`, so the length check happens first.
 */
export function requireInternalSecret(
  request: Request,
  expected: string | undefined,
): void {
  const provided = request.headers.get('x-thai-internal')
  if (expected === undefined || provided === null) {
    throw new HttpError('unauthorized', 'missing internal secret')
  }
  const expectedBuf = Buffer.from(expected)
  const providedBuf = Buffer.from(provided)
  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    throw new HttpError('unauthorized', 'invalid internal secret')
  }
}
