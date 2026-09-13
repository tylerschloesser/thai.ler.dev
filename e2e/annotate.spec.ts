import { expect, test } from './fixtures'
import {
  dialogueIdFromUrl,
  getCurrentAnnotationId,
  waitForAnnotationDone,
} from './testUtils'

test.describe('annotate', () => {
  test('paste the sample dialogue, click Annotate, and land on the rendered dialogue', async ({
    page,
    context,
  }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Load sample' }).click()
    await page.getByRole('button', { name: 'Annotate' }).click()

    await expect(page).toHaveURL(/\/d\/[^/]+$/)
    const dialogueId = dialogueIdFromUrl(page)

    // Every line of the 8-line sample dialogue renders as its own list item.
    await expect(page.getByRole('listitem')).toHaveCount(8)

    // Nudge the poller (`window.__thai.sync.pollNow`) instead of waiting on
    // the real 4s interval (`.claude/rules/testing.md`).
    const snapshot = await waitForAnnotationDone(page, dialogueId)
    expect(snapshot.status).toBe('complete')
    expect(snapshot.done).toBe(8)

    await expect(page.getByText('8/8 lines')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Retry failed' }),
    ).toHaveCount(0)

    // Romanization and gloss render underneath the first word chip, per the
    // display toggles' defaults (src/db/settings.ts SETTINGS_DEFAULTS).
    await expect(page.getByText('sà-wàt-dii')).toBeVisible()
    await expect(page.getByText('hello / greetings')).toBeVisible()

    // GET /api/annotation shows run.state 'done' server-side too, not just
    // the merged local copy.
    const annotationId = await getCurrentAnnotationId(page, dialogueId)
    const res = await context.request.get(
      `/api/annotation?id=${encodeURIComponent(annotationId!)}`,
    )
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.run.state).toBe('done')
  })
})
