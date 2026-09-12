import {
  BlobError,
  BlobNotFoundError,
  BlobPreconditionFailedError,
  del as blobDel,
  get as blobGet,
  list as blobList,
  put as blobPut,
} from '@vercel/blob'
import type { BlobStore } from './paths.js'
import { StorePreconditionError } from './paths.js'

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
      const res = await blobGet(pathname, {
        access: 'private',
        useCache: false,
      })
      if (!res || !res.stream) return null
      const value = (await new Response(res.stream).json()) as T
      return { value, etag: res.blob.etag }
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
        if (err instanceof BlobPreconditionFailedError) {
          throw new StorePreconditionError(pathname)
        }
        // Observed against the real preview store: put(..., { ifMatch })
        // on a missing blob answers a generic BlobError, "Vercel Blob: The
        // specified key does not exist." - not BlobPreconditionFailedError
        // or BlobNotFoundError. Check BlobNotFoundError by instanceof in
        // case a future SDK version does use it here; fall back to message
        // matching for the shape actually observed.
        if (err instanceof BlobNotFoundError) {
          throw new StorePreconditionError(pathname)
        }
        if (
          err instanceof BlobError &&
          err.message.includes('does not exist')
        ) {
          throw new StorePreconditionError(pathname)
        }
        throw err
      }
    },

    async list(prefix) {
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
    },

    async del(urls) {
      if (urls.length === 0) return
      await blobDel(urls)
    },
  }
}
