import { createContext } from './_lib/context.js'
import { failFromError, HttpError, json } from './_lib/http.js'
import { createRecordsApi } from './_lib/records.js'

export const config = { maxDuration: 300 }

/** `GET /api/annotation?id=` (PLAN.MD §4.1): a fresh, uncached read - polled by the client every 4s while a run is active. */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = createContext(request)
    const id = new URL(request.url).searchParams.get('id')
    if (!id) throw new HttpError('bad_request', 'id is required')

    const records = createRecordsApi(ctx.store, ctx.prefix)
    const record = await records.getAnnotation(id)
    if (!record)
      throw new HttpError('not_found', `annotation "${id}" not found`)

    return json(record)
  } catch (err) {
    return failFromError(err)
  }
}
