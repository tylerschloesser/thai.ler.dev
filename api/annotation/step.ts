import { waitUntil } from '@vercel/functions'
import { createContext } from '../_lib/context.js'
import { failFromError, HttpError, json } from '../_lib/http.js'
import { requireInternalSecret } from '../_lib/internalAuth.js'
import { createRecordsApi } from '../_lib/records.js'
import { buildRunnerContext, MAX_HOPS, runStep } from '../_lib/runner.js'

export const config = { maxDuration: 300 }

/**
 * `POST /api/annotation/step?id=` (PLAN.MD §4.1, §4.6): the runner's
 * continuation-hop target. Requires `x-thai-internal: $INTERNAL_SECRET`
 * (compared with `crypto.timingSafeEqual`); increments `run.hops` and
 * refuses (`409`) once `hops >= MAX_HOPS` - a defense-in-depth check, since
 * the caller (`api/_lib/runner.ts`) already declines to hop past that
 * point.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = createContext(request)
    requireInternalSecret(request, ctx.env.INTERNAL_SECRET)

    const id = new URL(request.url).searchParams.get('id')
    if (!id) throw new HttpError('bad_request', 'id is required')

    const records = createRecordsApi(ctx.store, ctx.prefix)
    const record = await records.getAnnotation(id)
    if (!record)
      throw new HttpError('not_found', `annotation "${id}" not found`)

    if (record.run.hops >= MAX_HOPS) {
      throw new HttpError('busy', 'max hops reached for this lineage')
    }

    const updated = {
      ...record,
      run: { ...record.run, hops: record.run.hops + 1 },
    }
    await records.putRecords(
      [{ kind: 'annotation', id: updated.id, value: updated }],
      { manifest: false },
    )

    waitUntil(
      runStep(buildRunnerContext(ctx), updated.id).catch((err: unknown) => {
        console.error(
          'runStep failed',
          err instanceof Error ? err.message : String(err),
        )
      }),
    )

    return json({}, 202)
  } catch (err) {
    return failFromError(err)
  }
}
