import { expect, test } from '../fixtures'
import {
  SAMPLE_DIALOGUE_TEXT,
  buildDialogue,
  pollAnnotationDone,
  postAnnotate,
} from './liveUtils'

/**
 * `@live` (PLAN.MD §4.8 `live/annotate`): fake provider, but real
 * `waitUntil` + real Vercel Blob. Posts the fixture dialogue via `POST
 * /api/annotate` from the primary namespace-scoped context, then reads it
 * back from a *fresh* browser context (same `thai_ns`, no shared in-memory
 * state) purely over HTTP - proving the job actually finished server-side
 * (real lease/flush/manifest writes against the preview Blob store), not
 * that some page's poller nudged it along.
 */

test.describe('live/annotate', () => {
  test(
    'a fresh context sees the fake-provider job finish via real Blob',
    { tag: '@live' },
    async ({ context, newContextSameNs }) => {
      test.setTimeout(60_000)

      const dialogue = buildDialogue(SAMPLE_DIALOGUE_TEXT)
      const { annotation } = await postAnnotate(
        context.request,
        dialogue,
        'claude-opus-5',
      )
      expect(annotation.run.state).toBe('queued')
      expect(annotation.lines).toHaveLength(8)

      const fresh = await newContextSameNs()
      const done = await pollAnnotationDone(
        fresh.request,
        annotation.id,
        45_000,
      )

      expect(done.run.state).toBe('done')
      expect(done.status).toBe('complete')
      expect(done.lines).toHaveLength(8)
      expect(done.lines.every((line) => line !== null)).toBe(true)
      expect(done.lineErrors.every((err) => err === null)).toBe(true)
    },
  )
})
