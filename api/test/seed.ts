import { z } from 'zod'
import { SETTINGS_RECORD_ID } from '../../src/lib/records.js'
import { createContext } from '../_lib/context.js'
import { failFromError, HttpError, json, readJson } from '../_lib/http.js'
import type { PutEntry } from '../_lib/records.js'
import { createRecordsApi } from '../_lib/records.js'
import {
  AnnotationRecordSchema,
  DialogueSchema,
  SettingRowSchema,
} from '../_lib/schemas.js'

export const config = { maxDuration: 300 }

const SeedBodySchema = z.object({
  dialogues: z.array(DialogueSchema).default([]),
  annotations: z.array(AnnotationRecordSchema).default([]),
  settings: z.array(SettingRowSchema).default([]),
})

/**
 * `POST /api/test/seed` (PLAN.MD §4.1, §4.8): writes server-owned test
 * fixtures directly (stalled jobs, remote-only records) - `ALLOW_TEST_MODE`
 * only, `404` otherwise so this route doesn't exist in production even by
 * accident.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = createContext(request)
    if (!ctx.testMode) throw new HttpError('not_found', 'not found')

    const body = await readJson(request, SeedBodySchema)
    const records = createRecordsApi(ctx.store, ctx.prefix)

    const entries: PutEntry[] = [
      ...body.dialogues.map((d): PutEntry => ({
        kind: 'dialogue',
        id: d.id,
        value: d,
      })),
      ...body.annotations.map((a): PutEntry => ({
        kind: 'annotation',
        id: a.id,
        value: a,
      })),
    ]
    if (body.settings.length > 0) {
      entries.push({
        kind: 'settings',
        id: SETTINGS_RECORD_ID,
        value: body.settings,
      })
    }
    if (entries.length > 0) {
      await records.putRecords(entries, { manifest: true })
    }

    return json({
      counts: {
        dialogues: body.dialogues.length,
        annotations: body.annotations.length,
        settings: body.settings.length,
      },
    })
  } catch (err) {
    return failFromError(err)
  }
}
