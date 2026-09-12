import { createContext } from '../_lib/context.js'
import { failFromError, json } from '../_lib/http.js'
import { createRecordsApi } from '../_lib/records.js'

export const config = { maxDuration: 300 }

/** `GET /api/sync/manifest` (PLAN.MD §4.1, §4.3): one uncached read; an empty manifest when none exists yet - never writes. */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = createContext(request)
    const records = createRecordsApi(ctx.store, ctx.prefix)
    const manifest = await records.getManifest()
    return json(manifest)
  } catch (err) {
    return failFromError(err)
  }
}
