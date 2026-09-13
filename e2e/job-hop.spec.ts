import { expect, test } from './fixtures'
import {
  dialogueIdFromUrl,
  getCurrentAnnotationId,
  waitForAnnotationDone,
} from './testUtils'

// PLAN.MD §4.8 `job-hop`: a tiny `thai_step_budget_ms` combined with a
// forced per-line `thai_fake_delay_ms` (`.claude/rules/api.md`'s runner
// section) means the 8-line sample job can't finish in a single step, so
// the runner has to hop to itself (`api/_lib/hop.ts`) at least once before
// the job completes.

test.describe('job-hop', () => {
  test('a tight step budget forces the runner to hop before the job completes', async ({
    page,
    context,
    fakeDelay,
    stepBudget,
  }) => {
    await stepBudget(1500)
    await fakeDelay(1000)

    await page.goto('/')
    await page.getByRole('button', { name: 'Load sample' }).click()
    await page.getByRole('button', { name: 'Annotate' }).click()

    await expect(page).toHaveURL(/\/d\/[^/]+$/)
    const dialogueId = dialogueIdFromUrl(page)

    const snapshot = await waitForAnnotationDone(page, dialogueId, 30_000)
    expect(snapshot.status).toBe('complete')

    const annotationId = await getCurrentAnnotationId(page, dialogueId)
    const res = await context.request.get(
      `/api/annotation?id=${encodeURIComponent(annotationId!)}`,
    )
    expect(res.ok()).toBe(true)
    const body = (await res.json()) as { run: { steps: number; hops: number } }
    expect(body.run.steps).toBeGreaterThanOrEqual(2)
    expect(body.run.hops).toBeGreaterThanOrEqual(1)
  })
})
