import type { AnnotationRecord } from '../../src/lib/records.js'
import { nowIso } from '../../src/lib/time.js'
import { createContext } from '../_lib/context.js'
import { failFromError, HttpError, json } from '../_lib/http.js'
import { createRecordsApi } from '../_lib/records.js'

export const config = { maxDuration: 300 }

/**
 * `POST /api/annotation/cancel?id=` (PLAN.MD §4.1): sets `run.state:
 * 'cancelled'`. The runner checks between lines and stops starting new ones
 * (already-started calls finish and are persisted) - see
 * `api/_lib/runner.ts`'s cancellation rules.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = createContext(request)
    const id = new URL(request.url).searchParams.get('id')
    if (!id) throw new HttpError('bad_request', 'id is required')

    const records = createRecordsApi(ctx.store, ctx.prefix)
    const record = await records.getAnnotation(id)
    if (!record)
      throw new HttpError('not_found', `annotation "${id}" not found`)

    if (record.run.state === 'done' || record.run.state === 'cancelled') {
      return json(record) // already finished; cancelling is a no-op
    }

    const updated: AnnotationRecord = {
      ...record,
      updatedAt: nowIso(),
      run: { ...record.run, state: 'cancelled', leaseUntil: null },
      status: record.lines.every((line) => line !== null)
        ? 'complete'
        : 'partial',
    }
    await records.putRecords(
      [{ kind: 'annotation', id: updated.id, value: updated }],
      { manifest: true },
    )

    return json(updated)
  } catch (err) {
    return failFromError(err)
  }
}
