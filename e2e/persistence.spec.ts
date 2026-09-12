import { expect, test } from './fixtures'

// The DialogueView page (`/d/$id`) is a placeholder until a later M4 wave
// builds it, so persistence here is asserted directly against IndexedDB
// via `window.__thai.db` (the same debug hook `seed` uses) rather than
// against page content - the goal of this spec is proving the annotation
// survives a reload, not exercising DialogueView's UI.
interface DebugWindow {
  __thai: {
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
            }
          | undefined
        >
      }
    }
  }
}

async function readAnnotationState(
  page: import('@playwright/test').Page,
  dialogueId: string,
): Promise<{ status: string; done: number; total: number } | null> {
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
      done: annotation.lines.filter((line) => line !== null).length,
      total: annotation.lines.length,
    }
  }, dialogueId)
}

test.describe('persistence', () => {
  test('an annotated dialogue survives a reload', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Load sample' }).click()
    await page.getByRole('button', { name: 'Annotate' }).click()

    await expect(page).toHaveURL(/\/d\/[^/]+$/)
    const dialogueId = new URL(page.url()).pathname.split('/').pop()
    if (!dialogueId)
      throw new Error('Could not read the dialogue id from the URL.')

    // NB: use expect.poll + page.evaluate, never page.waitForFunction with an
    // async predicate. waitForFunction resolves on the returned Promise being
    // truthy, so an async predicate always "passes" after a single poll and
    // the wait silently does nothing. page.evaluate does await properly.
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const win = window as unknown as DebugWindow
            const dialogue = await win.__thai.db.dialogues.get(id)
            if (!dialogue?.currentAnnotationId) return null
            const annotation = await win.__thai.db.annotations.get(
              dialogue.currentAnnotationId,
            )
            return annotation?.status ?? null
          }, dialogueId),
        { timeout: 15_000 },
      )
      .toBe('complete')

    const beforeReload = await readAnnotationState(page, dialogueId)
    expect(beforeReload?.status).toBe('complete')
    expect(beforeReload?.done).toBe(beforeReload?.total)
    expect(beforeReload?.total).toBeGreaterThan(0)

    await page.reload()

    const afterReload = await readAnnotationState(page, dialogueId)
    expect(afterReload).toEqual(beforeReload)
  })
})
