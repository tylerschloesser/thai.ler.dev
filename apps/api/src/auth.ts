import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { env } from './env.ts'

export const DEV_USER_ID = 'dev'

const HEADER_TOKEN_PATTERN = /^[A-Za-z0-9._-]{1,128}$/

/**
 * The single place the API learns who is calling. Every read and write is
 * partitioned by what this returns, so wiring up real auth is a change to this
 * function and nothing else.
 *
 * Today it has two modes, chosen by `env.auth`:
 *
 * - `constant` (the default, and what Lambda runs): always `DEV_USER_ID`.
 * - `header`: reads the caller's id from `x-id-token`, unverified. It exists
 *   only for local dev and e2e, where the point is a cheap per-test data
 *   partition, not real authentication. `header` mode is **local only** — the
 *   Lambda never sets `AUTH`, so deployed code always takes the `constant`
 *   path. This must never become a way to spoof a user in production.
 *
 * When Cognito lands, `constant` mode's body becomes:
 *
 *   const verifier = CognitoJwtVerifier.create({ userPoolId, tokenUse: 'id', clientId })
 *   const payload = await verifier.verify(c.req.header('x-id-token') ?? '')
 *   return payload.sub
 *
 * The token travels in `x-id-token`, not `Authorization`: CloudFront's origin
 * access control signs the origin request with SigV4 and writes its own
 * `Authorization` header, so a viewer-supplied one would be overwritten.
 */
export function getUserId(c: Context): string {
  if (env.auth === 'header') {
    const token = c.req.header('x-id-token')
    if (!token) return DEV_USER_ID
    if (!HEADER_TOKEN_PATTERN.test(token)) {
      throw new HTTPException(400, { message: 'invalid x-id-token' })
    }
    return token
  }
  return DEV_USER_ID
}
