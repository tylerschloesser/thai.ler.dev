import { expect, test } from './fixtures'
import {
  dialogueIdFromUrl,
  getCurrentAnnotationId,
  readAnnotationByDialogue,
  tickPoll,
  waitForAnnotationStatus,
} from './testUtils'

// PLAN.MD §4.8 `job-cancel`: a long (20-line, synthetic - not in the
// fixture, so the fake provider's `synthesizeLine` path handles every one
// of them) dialogue with a forced per-line delay stays mostly unattempted
// for several seconds, giving Cancel something real to interrupt.
//
// `api/_lib/runner.ts` only flushes progress to storage on a line error,
// every `FLUSH_EVERY_MS` (25s), or at the very end of a step - a job this
// short never shows partial progress before it finishes on its own, so
// clicking Cancel immediately (rather than waiting for visible progress
// first, which never comes) is the only way to interrupt it at all.
//
// `POST /api/annotation/cancel` leaves a *live* `leaseUntil` untouched
// (`api/annotation/cancel.ts`), so the in-flight runner's own final write -
// which persists whatever lines it actually finished - can still land.
// `src/sync/poll.ts`'s `isTerminal` only treats a `cancelled` record as
// terminal once that lease is gone too, and
// `src/features/dialogues/DialogueView.tsx`'s resume-on-open effect uses
// that exact same predicate for its watch guard, so the client keeps
// polling straight through the window between "cancel requested" and the
// runner's real final write instead of unsubscribing the moment the local
// (still all-null) cancel response lands. This spec drives that entirely
// through the client (`pollNow()` + `window.__thai.db`, the same path the
// real UI uses), with one server read via `context.request` for extra
// confidence that the same true state landed in storage.
test.describe('job-cancel', () => {
  test('cancelling a long-running job stops it partway, and Retry finishes it', async ({
    page,
    context,
    fakeDelay,
  }) => {
    test.setTimeout(30_000)

    await fakeDelay(3000)
    await page.goto('/')

    const lineCount = 20
    const sourceText = Array.from(
      { length: lineCount },
      (_, i) => `ผู้พูด${(i % 2) + 1}: ทดสอบประโยคที่ ${i + 1} สำหรับการยกเลิก`,
    ).join('\n')

    await page.getByLabel('Paste a Thai dialogue').fill(sourceText)
    await page.getByRole('button', { name: 'Annotate' }).click()

    await expect(page).toHaveURL(/\/d\/[^/]+$/)
    const dialogueId = dialogueIdFromUrl(page)

    // Cancel as soon as the running UI appears - see the note above for why
    // waiting for visible progress first would never work here.
    await page.getByRole('button', { name: 'Cancel' }).click()

    // Through the client: keep ticking the poller (as the real app does
    // every 4s) until the local record settles on 'cancelled' with the
    // runner's real, finished lines - not just the cancel endpoint's own
    // immediate (still all-null) write.
    await expect
      .poll(
        async () => {
          await tickPoll(page)
          const snapshot = await readAnnotationByDialogue(page, dialogueId)
          if (snapshot?.runState !== 'cancelled') return -1
          return snapshot.done
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThanOrEqual(1)

    const cancelledSnapshot = await readAnnotationByDialogue(page, dialogueId)
    expect(cancelledSnapshot).not.toBeNull()
    expect(cancelledSnapshot!.runState).toBe('cancelled')
    expect(cancelledSnapshot!.total).toBe(lineCount)
    expect(cancelledSnapshot!.done).toBeGreaterThanOrEqual(1)
    expect(cancelledSnapshot!.done).toBeLessThan(lineCount)

    // The UI reflects it too, from the same client-side poll.
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible()

    // Extra confidence: the same true state landed in storage, not just in
    // this tab's local copy.
    const annotationId = await getCurrentAnnotationId(page, dialogueId)
    const res = await context.request.get(
      `/api/annotation?id=${encodeURIComponent(annotationId!)}`,
    )
    expect(res.ok()).toBe(true)
    const serverRecord = (await res.json()) as {
      run: { state: string; leaseUntil: string | null }
      lines: unknown[]
    }
    expect(serverRecord.run.state).toBe('cancelled')
    expect(serverRecord.run.leaseUntil).toBeNull()
    expect(serverRecord.lines.filter((line) => line !== null).length).toBe(
      cancelledSnapshot!.done,
    )

    // Clear the delay so the retry finishes quickly, then resume the
    // remaining (still-null) lines.
    await fakeDelay(null)
    await page.getByRole('button', { name: 'Retry failed' }).click()

    const finalSnapshot = await waitForAnnotationStatus(
      page,
      dialogueId,
      'complete',
    )
    expect(finalSnapshot.done).toBe(lineCount)
  })
})
