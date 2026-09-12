import { createContext } from '../_lib/context.js'
import { failFromError, HttpError, json } from '../_lib/http.js'
import { isValidNamespace } from '../_lib/store/index.js'

export const config = { maxDuration: 300 }

/**
 * `DELETE /api/test/namespace?ns=` (PLAN.MD §4.1, §4.8): e2e teardown.
 * `ALLOW_TEST_MODE` only, `404` otherwise. Deletes only blobs under
 * `ns/<ns>/` - never the default `v1/` prefix, regardless of the request's
 * own `thai_ns` cookie.
 */
export async function DELETE(request: Request): Promise<Response> {
  try {
    const ctx = createContext(request)
    if (!ctx.testMode) throw new HttpError('not_found', 'not found')

    const ns = new URL(request.url).searchParams.get('ns')
    if (!ns || !isValidNamespace(ns)) {
      throw new HttpError('bad_request', 'invalid or missing ns')
    }

    const prefix = `ns/${ns}/v1/`
    const blobs = await ctx.store.list(prefix)
    await ctx.store.del(blobs.map((b) => b.url))

    return json({ deleted: blobs.length })
  } catch (err) {
    return failFromError(err)
  }
}
