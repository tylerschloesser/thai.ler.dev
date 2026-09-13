import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { APIRequestContext } from '@playwright/test'
import { expect } from '@playwright/test'
import type { AnnotationRecord, Dialogue } from '../../src/db/db'

/**
 * Live-only helpers (PLAN.MD §4.8/§5 M4): build a `Dialogue` payload and
 * drive it through the real `/api/annotate` + `/api/annotation` routes over
 * HTTP via a Playwright `APIRequestContext` - no page, no IndexedDB. Kept
 * separate from `e2e/testUtils.ts`, which polls through `window.__thai` and
 * is therefore page-only (a live/hop-style job must never have a page open,
 * since a page's poller could call `POST /api/annotation/resume` on a
 * stalled job and start a brand-new lineage instead of letting this one
 * finish).
 */

const SAMPLE_DIALOGUE_PATH = fileURLToPath(
  new URL('../../src/fixtures/sample.dialogue.txt', import.meta.url),
)

/**
 * The P0 fixture's 8-line dialogue. Every line matches
 * `src/fixtures/sample.annotation.json` by Thai text, so the fake provider
 * (`api/_lib/providers/fake.ts`) returns the real fixture annotation for
 * each rather than synthesizing one.
 */
export const SAMPLE_DIALOGUE_TEXT = readFileSync(SAMPLE_DIALOGUE_PATH, 'utf8')

export type LiveModelId = 'claude-opus-5' | 'claude-sonnet-5'

/** A minimal, schema-valid `Dialogue` payload for `POST /api/annotate` - never persisted anywhere but this request. */
export function buildDialogue(
  sourceText: string,
  title = 'live e2e dialogue',
): Dialogue {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    title,
    sourceText,
    currentAnnotationId: null,
  }
}

/**
 * Appends `count` lines the fixture doesn't contain, alternating speakers,
 * so the fake provider falls through to `synthesizeLine` for them (PLAN.MD
 * §5 M4 `live/hop` needs a job longer than the 8-line fixture to force
 * multiple hops).
 */
export function withSyntheticLines(sourceText: string, count: number): string {
  const speakers = ['พนักงาน', 'ลูกค้า']
  const extra = Array.from(
    { length: count },
    (_, i) => `${speakers[i % 2]}: extra line ${i + 1} ไม่ซ้ำ`,
  ).join('\n')
  return `${sourceText}\n${extra}`
}

/** `POST /api/annotate`; throws with the response body on anything but `202`. */
export async function postAnnotate(
  request: APIRequestContext,
  dialogue: Dialogue,
  model: LiveModelId,
): Promise<{ dialogue: Dialogue; annotation: AnnotationRecord }> {
  const res = await request.post('/api/annotate', {
    data: { dialogue, model },
  })
  if (res.status() !== 202) {
    throw new Error(
      `POST /api/annotate: expected 202, got ${res.status()}: ${await res.text()}`,
    )
  }
  return res.json()
}

/** `GET /api/annotation?id=`; throws with the response body on a non-ok response. */
export async function getAnnotation(
  request: APIRequestContext,
  id: string,
): Promise<AnnotationRecord> {
  const res = await request.get(`/api/annotation?id=${encodeURIComponent(id)}`)
  if (!res.ok()) {
    throw new Error(
      `GET /api/annotation: expected ok, got ${res.status()}: ${await res.text()}`,
    )
  }
  return res.json()
}

/**
 * Polls `GET /api/annotation` (request only, no page - see the module doc)
 * until `run.state` is `'done'`, then returns the final record.
 */
export async function pollAnnotationDone(
  request: APIRequestContext,
  id: string,
  timeout: number,
): Promise<AnnotationRecord> {
  await expect
    .poll(async () => (await getAnnotation(request, id)).run.state, {
      timeout,
    })
    .toBe('done')
  return getAnnotation(request, id)
}
