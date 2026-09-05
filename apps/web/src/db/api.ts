import { ErrorResponseSchema, StateResponseSchema, type StateResponse } from '@thai/schema'

/**
 * The API is same-origin (`/api/*` is a CloudFront behavior on this very
 * distribution), so there is no base URL to configure, no CORS, and no
 * preflight on mutations.
 */
const BASE = '/api'

/** A 4xx: the request will never succeed as written, so callers must not retry. */
export class ApiClientError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
  }
}

/**
 * The single place a request leaves the app. When auth lands, the ID token gets
 * attached here — in `x-id-token`, not `Authorization`, because CloudFront's
 * origin access control overwrites `Authorization` with its own SigV4 signature.
 */
async function request(
  path: string,
  options: { body?: string; signal?: AbortSignal } = {},
): Promise<unknown> {
  const { body, signal } = options

  const response = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    body,
    signal,
    headers:
      body === undefined
        ? undefined
        : {
            'content-type': 'application/json',
            // Required, not optional. CloudFront's origin access control signs
            // each origin request with SigV4, and Lambda function URLs reject
            // unsigned payloads — so a POST whose body hash is missing here is
            // answered 403 before the function is ever invoked.
            'x-amz-content-sha256': await sha256Hex(body),
          },
  })

  if (!response.ok) {
    throw new ApiClientError(response.status, await errorMessage(response))
  }

  return response.json()
}

/** Hex SHA-256, the encoding SigV4's `x-amz-content-sha256` expects. */
async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function errorMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined)
  const parsed = ErrorResponseSchema.safeParse(body)
  return parsed.success ? parsed.data.error : `${response.status} ${response.statusText}`
}

export async function fetchState(since: number, signal?: AbortSignal): Promise<StateResponse> {
  return StateResponseSchema.parse(
    await request(`/state?since=${encodeURIComponent(since)}`, { signal }),
  )
}

export async function pushMutations(body: unknown): Promise<StateResponse> {
  return StateResponseSchema.parse(
    await request('/mutations', { body: JSON.stringify(body) }),
  )
}
