import { expect, test } from './fixtures'
import type { AnnotationRecord, Dialogue, LineAnnotation } from '../src/db/db'
import { ANNOTATION_SCHEMA_VERSION } from '../src/db/db'
import { PROMPT_VERSION } from '../src/llm/prompt'
import { waitForAnnotationStatus } from './testUtils'

// PLAN.MD §4.8 `job-resume-on-open`: a `running` record whose lease is well
// in the past (§4.4/§10 "M3" - a stalled job never got a chance to
// finish, maybe the instance that held it died) sits in server storage
// only, seeded directly via `seedServer` (no local IndexedDB copy). Opening
// the dialogue pulls it down; `src/features/dialogues/DialogueView.tsx`'s
// resume-on-open effect starts `watchAnnotation`, whose first tick notices
// the stale lease (`src/sync/poll.ts`'s `isLeaseStalled`) and calls `POST
// /api/annotation/resume` itself - nothing else needs to happen.

interface DebugWindow {
  __thai: { sync: { pull: () => Promise<unknown> } }
}

function pull(page: import('@playwright/test').Page): Promise<unknown> {
  return page.evaluate(() =>
    (window as unknown as DebugWindow).__thai.sync.pull(),
  )
}

/** A minimal, schema-valid `LineAnnotation` for a seeded "already annotated" line - shape mirrors `api/_lib/providers/fake.ts`'s `synthesizeLine`. */
function makeLineAnnotation(thai: string): LineAnnotation {
  return {
    speaker: null,
    thai,
    translation: `[seed] ${thai}`,
    sentences: [
      {
        thai,
        romanization: '',
        translation: `[seed] ${thai}`,
        literal: null,
        words: [
          {
            thai,
            romanization: '',
            gloss: '[seed]',
            partOfSpeech: 'other',
            syllables: [
              {
                thai,
                romanization: '',
                tone: 'mid',
                toneExplanation: null,
                meaning: null,
              },
            ],
            notes: [],
          },
        ],
        notes: [],
      },
    ],
    notes: [],
  }
}

test.describe('job-resume-on-open', () => {
  test('opening a dialogue whose annotation stalled with an expired lease resumes it to completion', async ({
    page,
    context,
    seedServer,
  }) => {
    const dialogueId = 'e2e-resume-dialogue'
    const annotationId = 'e2e-resume-annotation'

    const lineTexts = Array.from(
      { length: 8 },
      (_, i) => `บรรทัดที่ ${i + 1} สำหรับทดสอบการกลับมาทำงานต่อ`,
    )
    const sourceText = lineTexts
      .map((text, i) => `ผู้พูด${(i % 2) + 1}: ${text}`)
      .join('\n')

    const now = Date.now()
    const staleLeaseUntil = new Date(now - 60_000).toISOString()
    const createdAt = new Date(now - 120_000).toISOString()

    const dialogue: Dialogue = {
      id: dialogueId,
      createdAt,
      updatedAt: staleLeaseUntil,
      deletedAt: null,
      title: 'Resume on open',
      sourceText,
      currentAnnotationId: annotationId,
    }

    const annotation: AnnotationRecord = {
      id: annotationId,
      createdAt,
      updatedAt: staleLeaseUntil,
      deletedAt: null,
      dialogueId,
      model: 'claude-sonnet-5',
      promptVersion: PROMPT_VERSION,
      schemaVersion: ANNOTATION_SCHEMA_VERSION,
      // 5 lines already annotated, 3 still null (the ones the resume must finish).
      lines: [
        ...lineTexts.slice(0, 5).map(makeLineAnnotation),
        null,
        null,
        null,
      ],
      lineErrors: new Array(8).fill(null),
      status: 'partial',
      usage: { inputTokens: 50, outputTokens: 50, cacheReadTokens: 0 },
      durationMs: 5_000,
      run: {
        state: 'running',
        provider: 'fake',
        leaseUntil: staleLeaseUntil,
        hops: 0,
        steps: 1,
        lastError: null,
      },
    }

    await seedServer({ dialogues: [dialogue], annotations: [annotation] })

    await page.goto(`/d/${dialogueId}`)
    // Force the pull deterministically rather than relying on the boot-time
    // pull's timing (`.claude/rules/testing.md`).
    await pull(page)

    const finalSnapshot = await waitForAnnotationStatus(
      page,
      dialogueId,
      'complete',
    )
    expect(finalSnapshot.done).toBe(8)

    const res = await context.request.get(
      `/api/annotation?id=${encodeURIComponent(annotationId)}`,
    )
    expect(res.ok()).toBe(true)
    const body = (await res.json()) as { run: { steps: number } }
    // Seeded at `steps: 1` - the resume must run at least one more step.
    expect(body.run.steps).toBeGreaterThan(1)
  })
})
