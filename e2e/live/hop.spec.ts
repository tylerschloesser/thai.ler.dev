import { expect, test } from '../fixtures'
import {
  SAMPLE_DIALOGUE_TEXT,
  buildDialogue,
  pollAnnotationDone,
  postAnnotate,
  withSyntheticLines,
} from './liveUtils'

/**
 * `@live` (PLAN.MD §4.2/§4.8 `live/hop`): proves the runner's self-hop path
 * (bypass header + `INTERNAL_SECRET`, `api/_lib/hop.ts`) survives multiple
 * hops on the real Vercel runtime without a `508`.
 *
 * `fakeDelay(2000)` + `stepBudget(3000)` gives `lineReserveMs =
 * min(70_000, floor(3000 / 2)) = 1500` (`api/_lib/runner.ts`). With
 * `CONCURRENCY = 6` and a 14-line job, reasoning from the runner code
 * (`.claude/rules/testing.md`/PLAN.MD §10 style):
 *
 *   - step 1: no line has succeeded yet, so it warms up on line 0 alone,
 *     then fans out 6 more (7 attempted total) - all 7 finish around
 *     `t=2000ms`, leaving only ~1000ms of the 3000ms budget, under the
 *     1500ms reserve, so the remaining 7 lines are never even popped from
 *     the queue this step -> hop.
 *   - step 2: a line already succeeded, so there's no warm-up; all 6
 *     workers start immediately (the "at least one line always starts"
 *     guarantee doesn't even need to kick in). They finish around
 *     `t=2000ms` with the same ~1000ms < 1500ms left, so the 1 remaining
 *     line is never popped -> hop again.
 *   - step 3: the last line starts immediately (guaranteed) and the job
 *     finishes with nothing left to hop for.
 *
 * That predicts exactly `run.steps === 3`, `run.hops === 2` - confirmed
 * against the local dev server (see the M4 implementer report). Real
 * network/Blob latency on Vercel could shift the boundary, so the
 * assertion only requires *at least* 2 hops (proving multiple hops don't
 * 508) plus a clean finish; the exact numbers are still recorded via
 * `testInfo.annotations` so a human can compare them against this
 * prediction after a real run.
 *
 * Polls via request only, on a namespace-scoped context that never opens a
 * page: a page's poller would call `POST /api/annotation/resume` on what
 * it sees as a stalled job and start a brand-new lineage (`hops: 0`)
 * instead of letting this one finish.
 */

test.describe('live/hop', () => {
  test(
    'a 14-line job needing multiple steps hops at least twice without a 508',
    { tag: '@live' },
    async ({ context, fakeDelay, stepBudget }, testInfo) => {
      test.setTimeout(90_000)

      await fakeDelay(2000)
      await stepBudget(3000)

      const dialogue = buildDialogue(
        withSyntheticLines(SAMPLE_DIALOGUE_TEXT, 6),
      )
      const { annotation } = await postAnnotate(
        context.request,
        dialogue,
        'claude-opus-5',
      )
      expect(annotation.lines).toHaveLength(14)

      const done = await pollAnnotationDone(
        context.request,
        annotation.id,
        75_000,
      )

      testInfo.annotations.push(
        { type: 'run.hops', description: String(done.run.hops) },
        { type: 'run.steps', description: String(done.run.steps) },
      )

      expect(done.run.state).toBe('done')
      expect(done.status).toBe('complete')
      expect(done.lines.every((line) => line !== null)).toBe(true)
      expect(done.run.hops).toBeGreaterThanOrEqual(2)
    },
  )
})
