import { expect, test } from './fixtures'

// `public/sw.js` replaces the service worker the retired AWS app registered
// at /sw.js (`.claude/rules/deploy.md`). A browser that still has the old
// worker must get real JavaScript from that URL — not the SPA shell the
// rewrite would otherwise return — and the worker must remove itself and
// the old precache without touching IndexedDB.

test.describe('sw kill switch', () => {
  test('/sw.js is served as JavaScript, not the SPA shell', async ({
    request,
  }) => {
    const res = await request.get('/sw.js')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('javascript')
    expect(await res.text()).toContain('registration.unregister()')
  })

  test('an installed /sw.js unregisters itself, clears caches, and keeps IndexedDB', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __thai?: unknown }).__thai),
    )

    // Stand in for the old app: a precache entry plus a registration at the
    // same URL and scope the AWS app used.
    await page.evaluate(async () => {
      const cache = await caches.open('workbox-precache-v2-old-app')
      await cache.put('/old-shell', new Response('old shell'))
      await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    })

    await expect
      .poll(() =>
        page.evaluate(async () => ({
          registrations: (await navigator.serviceWorker.getRegistrations())
            .length,
          caches: (await caches.keys()).length,
        })),
      )
      .toEqual({ registrations: 0, caches: 0 })

    const databases = await page.evaluate(async () =>
      (await indexedDB.databases()).map((db) => db.name),
    )
    expect(databases).toContain('thai.ler.dev')
  })
})
