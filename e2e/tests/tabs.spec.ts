import { expectIndicator, test } from '../fixtures.ts'

test('only the leader tab owns the offline queue', async ({ page, context }) => {
  await page.goto('/')
  await expectIndicator(page, 'Synced')

  const second = await context.newPage()
  await second.goto('/')

  // This is intended behaviour, not a bug: `@tanstack/offline-transactions`
  // elects one leader tab per browsing context to own the outbox, so a
  // second tab can only ever be online-only even though it shares the same
  // user and the same data.
  await expectIndicator(second, 'Online only')
  await expectIndicator(page, 'Synced')
})
