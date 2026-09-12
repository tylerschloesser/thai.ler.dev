import { createContext } from '../../_lib/context.js'
import { failFromError, json } from '../../_lib/http.js'
import { createRecordsApi } from '../../_lib/records.js'

export const config = { maxDuration: 300 }

/** `POST /api/sync/manifest/rebuild` (PLAN.MD §4.1, §4.3): lists every record blob, reads each, and rewrites the manifest from scratch. Maintenance-only. */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = createContext(request)
    const records = createRecordsApi(ctx.store, ctx.prefix)
    const manifest = await records.rebuildManifest()
    return json(manifest)
  } catch (err) {
    return failFromError(err)
  }
}
