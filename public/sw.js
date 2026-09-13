// Kill switch for the service worker that the retired AWS app (tag
// `archive/aws-main`, vite-plugin-pwa) registered at /sw.js with scope '/'.
// A browser that still has it installed keeps serving that app's precached
// shell on thai.ler.dev ("Couldn't load your translations."). On its next
// update check the browser fetches this file, installs it in place of the
// old worker, and it removes itself: it deletes the old precache,
// unregisters, and reloads open tabs so they load the current app from the
// network. IndexedDB is left alone. The current app registers no service
// worker, so nothing else ever installs this file.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.registration.unregister()
      const windows = await self.clients.matchAll({ type: 'window' })
      await Promise.all(windows.map((client) => client.navigate(client.url)))
    })(),
  )
})
