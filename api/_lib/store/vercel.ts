import {
  BlobError,
  BlobNotFoundError,
  BlobPreconditionFailedError,
  BlobStoreSuspendedError,
  del as blobDel,
  get as blobGet,
  list as blobList,
  put as blobPut,
} from '@vercel/blob'
import type { BlobStore } from './paths.js'
import { StorePreconditionError } from './paths.js'

/**
 * Thrown by `createVercelStore()` in place of `@vercel/blob`'s
 * `BlobStoreSuspendedError` (verified in `@vercel/blob@2.8.0`'s typings:
 * `declare class BlobStoreSuspendedError extends BlobError`) - a Hobby
 * store past its monthly quota answers every request this way until the
 * 30-day window resets (PLAN.MD §4.3, §9 risks, §5 M5). `api/_lib/http.ts`'s
 * `failFromError` maps this to a readable `fail('store', ...)` toast so
 * every handler gets the mapping for free; the app keeps reading from
 * IndexedDB regardless.
 */
export class StoreSuspendedError extends Error {
  constructor() {
    super('the Vercel Blob store is suspended (monthly quota exhausted)')
    this.name = 'StoreSuspendedError'
  }
}

/**
 * Shared error mapping for every backend call: a suspended store is checked
 * first (it can surface from `get`, `put`, `list`, or `del` alike), then -
 * for `put` only, via `checkPrecondition` - the two shapes an `ifMatch`
 * conflict can take.
 */
function mapBlobError(
  err: unknown,
  pathname: string,
  checkPrecondition: boolean,
): never {
  if (err instanceof BlobStoreSuspendedError) {
    throw new StoreSuspendedError()
  }
  if (checkPrecondition) {
    if (err instanceof BlobPreconditionFailedError) {
      throw new StorePreconditionError(pathname)
    }
    // Observed against the real preview store: put(..., { ifMatch }) on a
    // missing blob answers this generic BlobError, "Vercel Blob: The
    // specified key does not exist." - not BlobPreconditionFailedError or
    // BlobNotFoundError. Check BlobNotFoundError by instanceof in case a
    // future SDK version does use it here; fall back to message matching
    // for the shape actually observed.
    if (err instanceof BlobNotFoundError) {
      throw new StorePreconditionError(pathname)
    }
    if (err instanceof BlobError && err.message.includes('does not exist')) {
      throw new StorePreconditionError(pathname)
    }
  }
  throw err
}

/**
 * Real Vercel Blob backend (PLAN.MD §4.3, §10). The store is private and
 * every read passes `useCache: false` - private Blob is documented as
 * read-after-write consistent, but only when bypassing the CDN cache, which
 * matters here because the runner reads its own just-written record back
 * within the same request.
 *
 * `get()` resolves to `null` when the blob doesn't exist (verified against
 * `@vercel/blob@2.8.0`'s typings: `Promise<GetBlobResult | null>`) - no
 * `BlobNotFoundError` to catch, unlike `head()`. `put()` throws
 * `BlobPreconditionFailedError` when `ifMatch` doesn't match an existing
 * blob, but (verified against the real preview store)
 * a generic `BlobError` ("Vercel Blob: The specified key does not exist.")
 * when `ifMatch` is given and the blob doesn't exist at all - both are
 * mapped to `StorePreconditionError` so callers never need to know which
 * backend, or which of the SDK's error shapes, they're talking to.
 */
export function createVercelStore(): BlobStore {
  return {
    async getJson<T>(pathname: string) {
      try {
        const res = await blobGet(pathname, {
          access: 'private',
          useCache: false,
        })
        if (!res || !res.stream) return null
        const value = (await new Response(res.stream).json()) as T
        return { value, etag: res.blob.etag }
      } catch (err) {
        mapBlobError(err, pathname, false)
      }
    },

    async putJson(pathname, value, opts) {
      try {
        const res = await blobPut(pathname, JSON.stringify(value), {
          access: 'private',
          allowOverwrite: true,
          addRandomSuffix: false,
          contentType: 'application/json',
          ifMatch: opts?.ifMatch,
        })
        return { etag: res.etag }
      } catch (err) {
        mapBlobError(err, pathname, true)
      }
    },

    async list(prefix) {
      try {
        const out: Array<{ pathname: string; url: string }> = []
        let cursor: string | undefined
        do {
          const page = await blobList({ prefix, cursor, limit: 1000 })
          out.push(
            ...page.blobs.map((b) => ({ pathname: b.pathname, url: b.url })),
          )
          cursor = page.hasMore ? page.cursor : undefined
        } while (cursor)
        return out
      } catch (err) {
        mapBlobError(err, prefix, false)
      }
    },

    async del(urls) {
      if (urls.length === 0) return
      try {
        await blobDel(urls)
      } catch (err) {
        mapBlobError(err, urls.join(','), false)
      }
    },
  }
}
