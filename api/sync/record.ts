import { z } from 'zod'
import { RECORD_KINDS, SETTINGS_RECORD_ID } from '../../src/lib/records.js'
import { createContext } from '../_lib/context.js'
import { failFromError, HttpError, json, readJson } from '../_lib/http.js'
import { createRecordsApi } from '../_lib/records.js'
import {
  AnnotationRecordSchema,
  DialogueSchema,
  SettingRowSchema,
} from '../_lib/schemas.js'

export const config = { maxDuration: 300 }

const GetQuerySchema = z.object({
  kind: z.enum(RECORD_KINDS),
  id: z.string().min(1),
})

/** `GET /api/sync/record?kind=&id=` (PLAN.MD §4.1): for `settings`, `id` must be `all` and the record is the full `SettingRow[]` (`[]` when none). */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = createContext(request)
    const url = new URL(request.url)
    const parsed = GetQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    )
    if (!parsed.success) {
      throw new HttpError('bad_request', parsed.error.message)
    }
    const { kind, id } = parsed.data
    const records = createRecordsApi(ctx.store, ctx.prefix)

    if (kind === 'settings') {
      if (id !== SETTINGS_RECORD_ID) {
        throw new HttpError(
          'bad_request',
          `settings id must be "${SETTINGS_RECORD_ID}"`,
        )
      }
      const record = await records.getSettings()
      return json({ kind, record })
    }

    if (kind === 'dialogue') {
      const record = await records.getDialogue(id)
      if (!record)
        throw new HttpError('not_found', `dialogue "${id}" not found`)
      return json({ kind, record })
    }

    const record = await records.getAnnotation(id)
    if (!record)
      throw new HttpError('not_found', `annotation "${id}" not found`)
    return json({ kind, record })
  } catch (err) {
    return failFromError(err)
  }
}

const PutBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dialogue'), record: DialogueSchema }),
  z.object({ kind: z.literal('annotation'), record: AnnotationRecordSchema }),
  z.object({ kind: z.literal('settings'), record: z.array(SettingRowSchema) }),
])

/** `PUT /api/sync/record` (PLAN.MD §4.1): server-side LWW against the stored copy; returns the winner. Skips the write entirely when the stored copy wins. */
export async function PUT(request: Request): Promise<Response> {
  try {
    const ctx = createContext(request)
    const body = await readJson(request, PutBodySchema)
    const records = createRecordsApi(ctx.store, ctx.prefix)

    if (body.kind === 'settings') {
      const { record, changed } = await records.resolveSettingsUpsert(
        body.record,
      )
      if (changed) {
        await records.putRecords(
          [{ kind: 'settings', id: SETTINGS_RECORD_ID, value: record }],
          { manifest: true },
        )
      }
      return json({ kind: 'settings', record })
    }

    if (body.kind === 'dialogue') {
      const { record, changed } = await records.resolveDialogueUpsert(
        body.record,
      )
      if (changed) {
        await records.putRecords(
          [{ kind: 'dialogue', id: record.id, value: record }],
          { manifest: true },
        )
      }
      return json({ kind: 'dialogue', record })
    }

    const { record, changed } = await records.resolveAnnotationUpsert(
      body.record,
    )
    if (changed) {
      await records.putRecords(
        [{ kind: 'annotation', id: record.id, value: record }],
        { manifest: true },
      )
    }
    return json({ kind: 'annotation', record })
  } catch (err) {
    return failFromError(err)
  }
}
