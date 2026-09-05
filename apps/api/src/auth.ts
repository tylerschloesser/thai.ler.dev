import type { Context } from 'hono'

export const DEV_USER_ID = 'dev'

/**
 * The single place the API learns who is calling. Every read and write is
 * partitioned by what this returns, so wiring up real auth is a change to this
 * function and nothing else.
 *
 * Today it returns a constant. When Cognito lands it becomes:
 *
 *   const verifier = CognitoJwtVerifier.create({ userPoolId, tokenUse: 'id', clientId })
 *   const payload = await verifier.verify(c.req.header('x-id-token') ?? '')
 *   return payload.sub
 *
 * The token travels in `x-id-token`, not `Authorization`: CloudFront's origin
 * access control signs the origin request with SigV4 and writes its own
 * `Authorization` header, so a viewer-supplied one would be overwritten.
 */
export function getUserId(_c: Context): string {
  return DEV_USER_ID
}
