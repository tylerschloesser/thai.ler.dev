import { expect, test } from '../fixtures'
import type { Dialogue } from '../../src/db/db'
import { DB_SCHEMA_VERSION } from '../../src/db/db'
import type { Snapshot } from '../../src/db/snapshot'
import { SNAPSHOT_FORMAT } from '../../src/db/snapshot'

/** `window.__thai` typed just enough for this spec (see `e2e/testUtils.ts`'s `DebugWindow` - same pattern, but this file only needs `sync.pull`). `tsconfig.node.json` (which covers `e2e/**`) doesn't include `src/app/debug.ts`, so the global `Window.__thai` augmentation it declares isn't visible here. */
interface SyncWindow {
  __thai: { sync: { pull: () => Promise<unknown> } }
}

function makeDialogue(input: {
  id: string
  title: string
  sourceText: string
}): Dialogue {
  const now = new Date().toISOString()
  return {
    id: input.id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    title: input.title,
    sourceText: input.sourceText,
    currentAnnotationId: null,
  }
}

function makeSnapshot(dialogues: Dialogue[]): Snapshot {
  return {
    format: SNAPSHOT_FORMAT,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    deviceId: 'e2e-live-sync-a',
    dialogues,
    annotations: [],
    settings: [],
  }
}

/**
 * `@live` (PLAN.MD §4.8 `live/sync`): a dialogue created (and pushed) in one
 * browser context reaches a second, independent context in the same
 * `thai_ns` namespace purely through the real `/api/sync/*` routes and the
 * preview Blob store - exercising the real client sync loop
 * (`src/sync/push.ts` / `pull.ts`) against a real deployment, not just the
 * server handlers in isolation.
 */

test.describe('live/sync', () => {
  test(
    'a dialogue created in context A is pulled by context B',
    { tag: '@live' },
    async ({ page, seed, context, newContextSameNs }) => {
      test.setTimeout(45_000)

      const dialogue = makeDialogue({
        id: crypto.randomUUID(),
        title: `Live sync ${Date.now()}`,
        sourceText: 'พนักงาน: สวัสดีค่ะ\nลูกค้า: สวัสดีครับ',
      })

      await page.goto('/')
      await seed(makeSnapshot([dialogue]))

      // Confirm A's push actually reached the server before B ever pulls,
      // so B's pull can't race A's own outbox drain.
      await expect
        .poll(
          async () => {
            const res = await context.request.get(
              `/api/sync/record?kind=dialogue&id=${dialogue.id}`,
            )
            return res.ok()
          },
          { timeout: 20_000 },
        )
        .toBe(true)

      const contextB = await newContextSameNs()
      const pageB = await contextB.newPage()
      await pageB.goto('/')
      await pageB.evaluate(async () => {
        await (window as unknown as SyncWindow).__thai.sync.pull()
      })

      await expect(
        pageB.getByRole('link', { name: dialogue.title }),
      ).toBeVisible()
    },
  )
})
