import { expect, test } from './fixtures'
import {
  dialogueIdFromUrl,
  readAnnotationByDialogue,
  waitForAnnotationDone,
} from './testUtils'

interface DebugWindow {
  __thai: { sync: { pull: () => Promise<unknown> } }
}

test.describe('persistence', () => {
  test('an annotated dialogue survives a reload, and a fresh context in the same namespace pulls it from the server', async ({
    page,
    newContextSameNs,
  }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Load sample' }).click()
    await page.getByRole('button', { name: 'Annotate' }).click()

    await expect(page).toHaveURL(/\/d\/[^/]+$/)
    const dialogueId = dialogueIdFromUrl(page)

    const beforeReload = await waitForAnnotationDone(page, dialogueId)
    expect(beforeReload.status).toBe('complete')
    expect(beforeReload.done).toBe(beforeReload.total)
    expect(beforeReload.total).toBeGreaterThan(0)

    await page.reload()
    const afterReload = await readAnnotationByDialogue(page, dialogueId)
    expect(afterReload).toEqual(beforeReload)

    // A brand-new browser context in the same server-side namespace pulls
    // the same dialogue + annotation back out of Blob (PLAN.MD §4.8).
    const otherContext = await newContextSameNs()
    const otherPage = await otherContext.newPage()
    await otherPage.goto('/')
    await otherPage.evaluate(() =>
      (window as unknown as DebugWindow).__thai.sync.pull(),
    )
    const pulled = await readAnnotationByDialogue(otherPage, dialogueId)
    expect(pulled).toEqual(beforeReload)
  })
})
