import type { z } from 'zod'

/**
 * JSON response helpers shared by every `api/**` handler (PLAN.MD §4.1,
 * §10). Every response - success or error - carries `cache-control:
 * private, no-store` so nothing here is ever cached by the browser or a CDN
 * (records can contain per-user annotation state).
 */

export type ErrorKind =
  | 'bad_request'
  | 'not_found'
  | 'unauthorized'
  | 'busy'
  | 'provider'
  | 'store'
  | 'internal'

const STATUS: Record<ErrorKind, number> = {
  bad_request: 400,
  not_found: 404,
  unauthorized: 401,
  busy: 409,
  provider: 502,
  store: 502,
  internal: 500,
}

const NO_STORE = {
  'cache-control': 'private, no-store',
  'content-type': 'application/json',
}

/** Thrown by handlers/helpers; caught at the top of each handler and mapped to `fail()`. */
export class HttpError extends Error {
  readonly kind: ErrorKind

  constructor(kind: ErrorKind, message: string) {
    super(message)
    this.name = 'HttpError'
    this.kind = kind
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: NO_STORE })
}

export function fail(kind: ErrorKind, message: string): Response {
  return json({ error: { kind, message } }, STATUS[kind])
}

/** Maps any thrown error (an `HttpError` or not) to a JSON error `Response`. */
export function failFromError(error: unknown): Response {
  if (error instanceof HttpError) return fail(error.kind, error.message)
  const message = error instanceof Error ? error.message : String(error)
  return fail('internal', message)
}

/**
 * Parses and validates a JSON request body against `schema`. A missing/
 * malformed body or a schema mismatch throws `HttpError('bad_request', ...)`
 * rather than a bare parse error, so handlers can let it propagate to a
 * top-level `try/catch` -> `failFromError`.
 */
export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new HttpError('bad_request', parsed.error.message)
  }
  return parsed.data
}
