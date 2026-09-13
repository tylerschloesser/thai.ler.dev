import type { Page } from '@playwright/test'
import { expect } from './fixtures'

// Shared helpers for the M3 job-flow specs (PLAN.MD §4.8): never
// `page.waitForFunction` with an async predicate (it resolves as soon as
// the returned *Promise* is truthy, so it "passes" after one poll no matter
// what the predicate actually returns - `.claude/rules/testing.md`). Use
// `expect.poll()` + `page.evaluate()` instead, and tick
// `window.__thai.sync.pollNow()` on every attempt rather than waiting on
// the real 4s poll interval.

interface DebugWindow {
  __thai: {
    sync: { pollNow: () => Promise<void> }
    db: {
      dialogues: {
        get(
          id: string,
        ): Promise<{ currentAnnotationId: string | null } | undefined>
      }
      annotations: {
        get(id: string): Promise<
          | {
              status: 'partial' | 'complete'
              lines: unknown[]
              lineErrors: (string | null)[]
              run: { state: string }
            }
          | undefined
        >
      }
    }
  }
}

export interface AnnotationSnapshot {
  status: 'partial' | 'complete'
  runState: string
  done: number
  total: number
}

/** Reads the dialogue's current annotation straight out of IndexedDB via `window.__thai.db` (same debug hook `seed` uses) - `null` if there is no dialogue or no current annotation yet. */
export async function readAnnotationByDialogue(
  page: Page,
  dialogueId: string,
): Promise<AnnotationSnapshot | null> {
  return page.evaluate(async (id) => {
    const win = window as unknown as DebugWindow
    const dialogue = await win.__thai.db.dialogues.get(id)
    if (!dialogue?.currentAnnotationId) return null
    const annotation = await win.__thai.db.annotations.get(
      dialogue.currentAnnotationId,
    )
    if (!annotation) return null
    return {
      status: annotation.status,
      runState: annotation.run.state,
      done: annotation.lines.filter((line) => line !== null).length,
      total: annotation.lines.length,
    }
  }, dialogueId)
}

/** Ticks every currently-watched annotation's poller immediately (`window.__thai.sync.pollNow`). */
export async function tickPoll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const win = window as unknown as DebugWindow
    await win.__thai.sync.pollNow()
  })
}

/** Ticks the poller and waits for the dialogue's current annotation to reach `run.state: 'done'`, then returns its final snapshot. */
export async function waitForAnnotationDone(
  page: Page,
  dialogueId: string,
  timeout = 15_000,
): Promise<AnnotationSnapshot> {
  await expect
    .poll(
      async () => {
        await tickPoll(page)
        const snapshot = await readAnnotationByDialogue(page, dialogueId)
        return snapshot?.runState ?? null
      },
      { timeout },
    )
    .toBe('done')
  const snapshot = await readAnnotationByDialogue(page, dialogueId)
  if (!snapshot) {
    throw new Error('waitForAnnotationDone: annotation vanished after done')
  }
  return snapshot
}

/**
 * Ticks the poller and waits for the dialogue's current annotation to reach
 * a *specific* `done` status (`complete` or `partial`) — unlike
 * `waitForAnnotationDone`, this never resolves early against a stale
 * "already done" record left over from a *previous* run (e.g. right after
 * clicking Retry, before the resume's `queued` transition has even landed
 * locally) — it keeps polling until the merged status actually matches.
 */
export async function waitForAnnotationStatus(
  page: Page,
  dialogueId: string,
  status: 'complete' | 'partial',
  timeout = 15_000,
): Promise<AnnotationSnapshot> {
  await expect
    .poll(
      async () => {
        await tickPoll(page)
        const snapshot = await readAnnotationByDialogue(page, dialogueId)
        return snapshot?.runState === 'done' ? snapshot.status : null
      },
      { timeout },
    )
    .toBe(status)
  const snapshot = await readAnnotationByDialogue(page, dialogueId)
  if (!snapshot) {
    throw new Error('waitForAnnotationStatus: annotation vanished after done')
  }
  return snapshot
}

/** The current annotation id for `dialogueId`, or `null` if it has none yet. */
export async function getCurrentAnnotationId(
  page: Page,
  dialogueId: string,
): Promise<string | null> {
  return page.evaluate(async (id) => {
    const win = window as unknown as DebugWindow
    const dialogue = await win.__thai.db.dialogues.get(id)
    return dialogue?.currentAnnotationId ?? null
  }, dialogueId)
}

/** The dialogue id from the current `/d/<id>` URL. */
export function dialogueIdFromUrl(page: Page): string {
  const id = new URL(page.url()).pathname.split('/').pop()
  if (!id) throw new Error('Could not read the dialogue id from the URL.')
  return id
}
