import { createExample, expect, expectIndicator, test } from '../fixtures.ts'

// Sleeps are banned everywhere else in this suite, but the ones here are the
// test: there is no event to await for "the service worker has taken over",
// and a fixed offline window is the scenario rather than something to skip.
test.setTimeout(90_000)

test('the shell boots offline, writes queue, and reconnecting drains them', async ({ page }) => {
  await page.goto('/')
  await expectIndicator(page, 'Synced')

  // Wait for the service worker to actually be controlling the page, so the
  // reload below tests its cache rather than racing its install.
  // Cast: this package's `lib` is Node's, not the DOM's, so `Navigator` here is
  // the fetch-only shape @types/node declares — it has no `serviceWorker`, even
  // though the callback genuinely runs in a browser.
  await page.evaluate(() =>
    (navigator as Navigator & { serviceWorker: { ready: Promise<unknown> } }).serviceWorker
      .ready,
  )

  // One row synced before going offline, so the reload below has real cached
  // data to prove itself against rather than an empty list either way. The
  // reload here is online and deliberate: `Synced` only samples the outbox in
  // memory, and reading it back off disk is what proves the drained entry is
  // really gone — otherwise it reappears after the *offline* reload and the
  // queue count below is off by one.
  await createExample(page)
  await expectIndicator(page, 'Synced')
  await page.reload()
  await expectIndicator(page, 'Synced')
  await expect(page.getByRole('listitem')).toHaveCount(1)

  await page.context().setOffline(true)
  await page.waitForTimeout(5_000)

  // With no network at all, anything rendering means the shell came out of the
  // service worker's cache, and the row means the query cache came off disk.
  await page.reload()
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await expectIndicator(page, 'Offline')

  // A write made offline queues in the outbox instead of failing.
  await createExample(page)
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await expectIndicator(page, 'Offline · 1 queued')

  // Reconnecting drains the outbox. The indicator returning to `Synced` is the
  // assertion here, rather than the pending pill clearing: a finished row does
  // not reach this list without a navigation today
  // (https://github.com/tylerschloesser/thai.ler.dev/issues/2), and
  // translate.spec.ts already covers a row going ready on the detail route.
  await page.context().setOffline(false)
  await expectIndicator(page, 'Synced', { timeout: 30_000 })
  await expect(page.getByRole('listitem')).toHaveCount(2)
})

// Known bug, not dead code. The test above reloads offline exactly once, which
// works. A *second* offline reload — one made after a refetch has already
// failed with no network — comes back with an empty list: the outbox survives
// and the indicator still reads `Offline · 1 queued`, but every row is gone,
// including ones that synced before going offline. That is
// https://github.com/tylerschloesser/thai.ler.dev/issues/1. Dropping this
// `fixme` is how to check whether the fix landed; don't rewrite it to pass
// some other way.
test.fixme('rows and the outbox survive a reload made after a failed offline refetch', async ({
  page,
}) => {
  await page.goto('/')
  await expectIndicator(page, 'Synced')

  await page.evaluate(() =>
    (navigator as Navigator & { serviceWorker: { ready: Promise<unknown> } }).serviceWorker
      .ready,
  )

  await createExample(page)
  await expectIndicator(page, 'Synced')

  await page.context().setOffline(true)
  await page.waitForTimeout(5_000)

  await page.reload()
  await expect(page.getByRole('listitem')).toHaveCount(1)

  await createExample(page)
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await expectIndicator(page, 'Offline · 1 queued')

  // Long enough for the refetch behind the list to fail with no network.
  await page.waitForTimeout(3_000)
  await page.reload()

  await expect(page.getByRole('listitem')).toHaveCount(2)
  await expectIndicator(page, 'Offline · 1 queued')

  await page.context().setOffline(false)
  await expectIndicator(page, 'Synced', { timeout: 30_000 })
})
