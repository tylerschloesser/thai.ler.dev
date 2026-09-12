import { expect, test } from './fixtures'
import type { Dialogue } from '../src/db/db'
import { DB_SCHEMA_VERSION } from '../src/db/db'
import type { Snapshot } from '../src/db/snapshot'
import { SNAPSHOT_FORMAT } from '../src/db/snapshot'

/** A one-line, not-yet-annotated dialogue: `AnnotateStatus` renders a
 * "Start annotation" button for it (`total === 0 && !isRunning`), which
 * triggers a `/v1/messages` request for that line. The Anthropic SDK
 * client (src/llm/client.ts) retries 429/500 responses itself (default
 * `maxRetries: 2`, so up to 3 attempts) before giving up, so
 * `mockAnthropicError` must fail every attempt - not just the first - or
 * the SDK's own retry silently succeeds against the default mock and the
 * line never actually fails. */
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
  test('a 429 shows a toast, marks the line failed, and retry succeeds once the mock recovers', async ({
    page,
    seed,
    mockAnthropicError,
  }) => {
    const dialogueId = 'e2e-errors-429'
    await page.goto('/')
    await seed(makeSnapshot(dialogueId))

    // No `times`: fails every attempt, including the SDK's own retries,
    // until reset below.
    await mockAnthropicError({ status: 429 })

    await page.goto(`/d/${dialogueId}`)
    await page.getByRole('button', { name: 'Start annotation' }).click()

    await expect(page.getByText('Line 1 failed to annotate')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText('Failed', { exact: true })).toBeVisible()
    const retryButton = page.getByRole('button', { name: 'Retry failed' })
    await expect(retryButton).toBeVisible()

    // Reset the override before retrying: `times: 0` means the next
    // request (and the SDK's own retries, if any) fall through to the
    // default fixture-backed success mock.
    await mockAnthropicError({ status: 429, times: 0 })
    await retryButton.click()

    await expect(page.getByText('1/1 lines')).toBeVisible()
    await expect(page.getByText('Failed', { exact: true })).toHaveCount(0)
  })

  test('a 500 shows a toast and marks the line failed', async ({
    page,
    seed,
    mockAnthropicError,
  }) => {
    const dialogueId = 'e2e-errors-500'
    await page.goto('/')
    await seed(makeSnapshot(dialogueId))

    await mockAnthropicError({ status: 500 })

    await page.goto(`/d/${dialogueId}`)
    await page.getByRole('button', { name: 'Start annotation' }).click()

    await expect(page.getByText('Line 1 failed to annotate')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText('Failed', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Retry failed' }),
    ).toBeVisible()
  })
})
