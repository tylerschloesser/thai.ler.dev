import { waitUntil } from '@vercel/functions'
import { z } from 'zod'
import { newId } from '../src/lib/ids.js'
import type { AnnotationRecord, Dialogue } from '../src/lib/records.js'
import { nowIso } from '../src/lib/time.js'
import { PROMPT_VERSION } from '../src/llm/prompt.js'
import { SCHEMA_VERSION } from '../src/llm/schema.js'
import { splitDialogue } from '../src/llm/split.js'
import { createContext } from './_lib/context.js'
import { failFromError, json, readJson } from './_lib/http.js'
import { selectNewJobProvider } from './_lib/providers/index.js'
import { createRecordsApi } from './_lib/records.js'
import { buildRunnerContext, runStep } from './_lib/runner.js'
import { DialogueSchema, MODEL_IDS } from './_lib/schemas.js'

export const config = { maxDuration: 300 }

const AnnotateBodySchema = z.object({
  dialogue: DialogueSchema,
  model: z.enum(MODEL_IDS),
})

/**
 * `POST /api/annotate` (PLAN.MD §4.1, §4.2): upserts the dialogue (LWW),
 * creates a fresh `queued` `AnnotationRecord`, writes both + the manifest in
 * one call, then kicks off the first step in `waitUntil` and returns 202
 * immediately - the response never waits on any line completing.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = createContext(request)
    const body = await readJson(request, AnnotateBodySchema)
    const records = createRecordsApi(ctx.store, ctx.prefix)

    const { record: dialogueWinner } = await records.resolveDialogueUpsert(
      body.dialogue,
    )
    const splitLines = splitDialogue(dialogueWinner.sourceText)
    const now = nowIso()
    const annotationId = newId()

    const dialogue: Dialogue = {
      ...dialogueWinner,
      currentAnnotationId: annotationId,
      updatedAt: now,
    }

    const annotation: AnnotationRecord = {
      id: annotationId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      dialogueId: dialogue.id,
      model: body.model,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      lines: new Array(splitLines.length).fill(null),
      lineErrors: new Array(splitLines.length).fill(null),
      status: 'partial',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      durationMs: 0,
      run: {
        state: 'queued',
        provider: selectNewJobProvider(ctx),
        leaseUntil: null,
        hops: 0,
        steps: 0,
        lastError: null,
      },
    }

    await records.putRecords(
      [
        { kind: 'dialogue', id: dialogue.id, value: dialogue },
        { kind: 'annotation', id: annotation.id, value: annotation },
      ],
      { manifest: true },
    )

    waitUntil(
      runStep(buildRunnerContext(ctx), annotation.id).catch((err: unknown) => {
        console.error(
          'runStep failed',
          err instanceof Error ? err.message : String(err),
        )
      }),
    )

    return json({ dialogue, annotation }, 202)
  } catch (err) {
    return failFromError(err)
  }
}
