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
 *
 * `leaseUntil` is left untouched when a runner still visibly holds it (live
 * lease, i.e. a step is genuinely in flight right now): clearing it here
 * would make the record look immediately terminal (`src/sync/poll.ts`'s
 * `isTerminal`) even though the in-flight step hasn't persisted its
 * already-completed lines yet, which used to make the client stop polling
 * before those lines ever reached the UI. The runner's own final write
 * (`api/_lib/runner.ts`) always clears `leaseUntil` to `null` once it
 * actually observes the cancellation, so the record becomes terminal then,
 * with the real data. If no runner holds the lease (already `null`, or
 * expired), there's nothing to wait for, and this behaves as before.
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

    const leaseLive =
      record.run.leaseUntil !== null &&
      Date.parse(record.run.leaseUntil) > Date.now()

    const updated: AnnotationRecord = {
      ...record,
      updatedAt: nowIso(),
      run: {
        ...record.run,
        state: 'cancelled',
        leaseUntil: leaseLive ? record.run.leaseUntil : null,
      },
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
