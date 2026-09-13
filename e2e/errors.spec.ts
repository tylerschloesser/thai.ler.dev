import { expect, test } from './fixtures'
import type { Dialogue } from '../src/db/db'
import { DB_SCHEMA_VERSION } from '../src/db/db'
import type { Snapshot } from '../src/db/snapshot'
import { SNAPSHOT_FORMAT } from '../src/db/snapshot'
import { waitForAnnotationStatus } from './testUtils'

function makeSnapshot(dialogueId: string): Snapshot {
  const now = new Date().toISOString()
  const dialogue: Dialogue = {
    id: dialogueId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    title: 'Ordering coffee',
    sourceText: 'พนักงาน: สวัสดีค่ะ รับอะไรดีคะ',
    currentAnnotationId: null,
  }
  return {
    format: SNAPSHOT_FORMAT,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: now,
    deviceId: 'e2e-errors-spec',
    dialogues: [dialogue],
    annotations: [],
    settings: [],
  }
}

test.describe('errors', () => {
  test('a failed line shows a toast + Failed status, and Retry succeeds once the error clears', async ({
    page,
    seed,
    fakeError,
  }) => {
    const dialogueId = 'e2e-errors-line'
    await page.goto('/')
    await seed(makeSnapshot(dialogueId))
    await fakeError('rate_limited')

    await page.goto(`/d/${dialogueId}`)
    await page.getByRole('button', { name: 'Start annotation' }).click()

    // `api/_lib/runner.ts` now counts a line as *attempted* the moment its
    // provider call returns (success or `AnnotateError`), not just "still
    // non-null" - so a single always-failing line ends the job in one step
    // (`run.state: 'done'`, `status: 'partial'`, no hop), which the client
    // renders as the `failed` state (`useAnnotate.ts`'s
    // `deriveAnnotateState`) as soon as the next poll tick lands.
    await expect(page.getByText('Line 1 failed to annotate')).toBeVisible({
      timeout: 10_000,
    })
    // Two distinct "Failed" texts now render once the job reaches
    // `run.state: 'done'` + `status: 'partial'`: the per-line status badge
    // (`LineView`) and the overall run state (`AnnotateStatus`'s
    // `deriveAnnotateState`) - assert both, scoped so they can't collide.
    const lines = page.getByRole('list', { name: 'Dialogue lines' })
    await expect(lines.getByText('Failed', { exact: true })).toBeVisible()
    const runStatus = page.getByText('0/1 lines').locator('..')
    await expect(runStatus.getByText('Failed', { exact: true })).toBeVisible()
    const retryButton = page.getByRole('button', { name: 'Retry failed' })
    await expect(retryButton).toBeVisible()

    // Clear the injected error before retrying, so the next attempt (and
    // any lines the runner re-runs) hits the default fake-provider success
    // path instead. Once the job reached `run.state: 'done'` above,
    // `src/sync/poll.ts`'s `watchAnnotation` already stopped polling it
    // (`isTerminal`) - a `done` record is never "stalled", so its own
    // autonomous stalled-resume can no longer race this manual Retry click.
    await fakeError(null)
    await retryButton.click()

    await waitForAnnotationStatus(page, dialogueId, 'complete')
    await expect(page.getByText('1/1 lines')).toBeVisible()
    await expect(page.getByText('Failed', { exact: true })).toHaveCount(0)
  })
})
