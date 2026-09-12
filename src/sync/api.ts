import type {
  AnnotationRecord,
  Dialogue,
  Manifest,
  RecordKind,
} from '../lib/records'

// Typed `fetch` wrappers for the sync/annotation API surface this client
// depends on (PLAN.MD §4.1 — the interface M1 (`api/**`) and M2 (this
// module) agree on; M1 owns the actual routes). Every non-2xx response is
// `{ error: { kind, message } }`; a `fetch` throw (offline, DNS failure,
// CORS, ...) is normalized to `ApiError('offline', ...)` so callers never
// need a separate try/catch for "no network" vs. "server said no".

export type ApiErrorKind =
  | 'bad_request'
  | 'not_found'
  | 'unauthorized'
  | 'busy'
  | 'provider'
  | 'store'
  | 'internal'
  | 'offline'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number

  constructor(kind: ApiErrorKind, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
}

interface ErrorBody {
  error: { kind: ApiErrorKind; message: string }
}

function isErrorBody(value: unknown): value is ErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'object'
  )
}

async function request<T>(
  fetchImpl: typeof fetch,
  input: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response
  try {
    response = await fetchImpl(input, init)
  } catch (err) {
    throw new ApiError(
      'offline',
      err instanceof Error ? err.message : 'Network request failed',
      0,
    )
  }

  const text = await response.text()
  const body: unknown = text.length > 0 ? JSON.parse(text) : null

  if (!response.ok) {
    if (isErrorBody(body)) {
      throw new ApiError(body.error.kind, body.error.message, response.status)
    }
    throw new ApiError(
      'internal',
      `Request to ${input} failed with status ${response.status}`,
      response.status,
    )
  }

  return body as T
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export interface AnnotateInput {
  dialogue: Dialogue
  model: string
}

export interface AnnotateOutput {
  dialogue: Dialogue
  annotation: AnnotationRecord
}

export type ResumeOutcome =
  { status: 'started'; record: AnnotationRecord } | { status: 'busy' }

export interface SyncApi {
  getManifest(): Promise<Manifest>
  /** `record` is `unknown` at this layer — callers know the shape from `kind`. */
  getRecord(kind: RecordKind, id: string): Promise<unknown>
  putRecord(kind: RecordKind, record: unknown): Promise<unknown>
  getAnnotation(id: string): Promise<AnnotationRecord>
  annotate(input: AnnotateInput): Promise<AnnotateOutput>
  resumeAnnotation(id: string): Promise<ResumeOutcome>
  cancelAnnotation(id: string): Promise<AnnotationRecord>
  rebuildManifest(): Promise<Manifest>
}

/**
 * Builds a `SyncApi` bound to `fetchImpl` (defaults to the global `fetch`),
 * so `src/sync/{pull,push,poll}.ts` and their tests can inject a stub
 * instead of hitting the network.
 */
export function createApi(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): SyncApi {
  return {
    async getManifest() {
      return request<Manifest>(fetchImpl, '/api/sync/manifest')
    },

    async getRecord(kind, id) {
      const body = await request<{ kind: RecordKind; record: unknown }>(
        fetchImpl,
        `/api/sync/record?kind=${kind}&id=${encodeURIComponent(id)}`,
      )
      return body.record
    },

    async putRecord(kind, record) {
      const body = await request<{ kind: RecordKind; record: unknown }>(
        fetchImpl,
        '/api/sync/record',
        jsonInit('PUT', { kind, record }),
      )
      return body.record
    },

    async getAnnotation(id) {
      return request<AnnotationRecord>(
        fetchImpl,
        `/api/annotation?id=${encodeURIComponent(id)}`,
      )
    },

    async annotate(input) {
      return request<AnnotateOutput>(
        fetchImpl,
        '/api/annotate',
        jsonInit('POST', input),
      )
    },

    async resumeAnnotation(id) {
      try {
        const record = await request<AnnotationRecord>(
          fetchImpl,
          `/api/annotation/resume?id=${encodeURIComponent(id)}`,
          { method: 'POST' },
        )
        return { status: 'started', record }
      } catch (err) {
        if (err instanceof ApiError && err.kind === 'busy') {
          return { status: 'busy' }
        }
        throw err
      }
    },

    async cancelAnnotation(id) {
      return request<AnnotationRecord>(
        fetchImpl,
        `/api/annotation/cancel?id=${encodeURIComponent(id)}`,
        { method: 'POST' },
      )
    },

    async rebuildManifest() {
      return request<Manifest>(fetchImpl, '/api/sync/manifest/rebuild', {
        method: 'POST',
      })
    },
  }
}

/** Shared default instance, bound to the global `fetch`. */
export const api = createApi()
