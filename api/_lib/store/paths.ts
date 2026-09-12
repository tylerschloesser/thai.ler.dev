/**
 * Shared kernel for `api/_lib/store/`: the `BlobStore` interface, the
 * precondition error every backend throws, and the path/prefix helpers
 * (PLAN.MD §4.3). Deliberately dependency-free so `memory.ts`, `disk.ts`,
 * `vercel.ts` and `index.ts` can all import from here without creating a
 * circular module graph (`index.ts` imports the three backends; if the
 * shared types lived in `index.ts` instead, the backends would have to
 * import back from it).
 */

/** A single Vercel Blob store, backed by an in-memory Map, local disk, or the real API. */
export interface BlobStore {
  getJson<T>(path: string): Promise<{ value: T; etag: string } | null>
  putJson(
    path: string,
    value: unknown,
    opts?: { ifMatch?: string },
  ): Promise<{ etag: string }>
  /** All pages, prefix-filtered. */
  list(prefix: string): Promise<Array<{ pathname: string; url: string }>>
  del(urls: string[]): Promise<void>
}

export type BlobBackend = 'memory' | 'disk' | 'vercel'

/**
 * Thrown by every backend's `putJson` when `ifMatch` is given and either
 * doesn't match the blob's current etag, or the blob doesn't exist at all.
 */
export class StorePreconditionError extends Error {
  readonly path: string

  constructor(path: string) {
    super(`store precondition failed for "${path}"`)
    this.name = 'StorePreconditionError'
    this.path = path
  }
}

const NS_RE = /^[a-z0-9-]{1,64}$/

export function isValidNamespace(ns: string): boolean {
  return NS_RE.test(ns)
}

/**
 * The path prefix every blob for this request lives under: `v1/` normally,
 * or `ns/<ns>/v1/` in test mode so each e2e test gets an isolated slice of
 * the store. Throws on an invalid namespace - callers should validate with
 * `isValidNamespace` first (e.g. to fall back to no namespace) if they'd
 * rather not throw.
 */
export function prefixFor(ns: string | null): string {
  if (ns === null) return 'v1/'
  if (!isValidNamespace(ns)) {
    throw new Error(`invalid namespace: "${ns}"`)
  }
  return `ns/${ns}/v1/`
}

export function manifestPath(prefix: string): string {
  return `${prefix}manifest.json`
}

export type RecordKind = 'dialogue' | 'annotation'

export function recordPath(
  prefix: string,
  kind: RecordKind,
  id: string,
): string {
  return `${prefix}${kind}s/${id}.json`
}

export function settingsPath(prefix: string): string {
  return `${prefix}settings.json`
}
