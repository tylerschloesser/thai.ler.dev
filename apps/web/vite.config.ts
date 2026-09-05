import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Mirrors the CloudFront `/api/*` behavior so the client uses one same-origin
// path everywhere and needs no base URL. The default target is the local API
// from `pnpm --filter api start` — no AWS, no production data. `API_TARGET`
// overrides it; `pnpm dev:prod` sets it to `https://thai.ler.dev` to run
// against production, where local writes become production writes.
const apiProxy = {
  '/api': { target: process.env.API_TARGET ?? 'http://localhost:8787', changeOrigin: true },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Must precede the React plugin so generated route modules are transformed.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    // Persisting data offline is only half of it: without a service worker to
    // serve the app shell, a reload with no connection never boots the app that
    // would read that data. This precaches the shell so a cold start offline
    // renders from IndexedDB.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // registered explicitly in main.tsx
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Every navigation resolves to the SPA shell, matching the CloudFront
        // Function that does the same at the edge when online.
        navigateFallback: '/index.html',
        // The API must never be served from the cache. Reads are already
        // durable through the persisted query cache, and writes are durable
        // through the outbox — a cached API response would just be a stale
        // answer competing with both.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
      manifest: {
        name: 'Thai dialog',
        short_name: 'Thai dialog',
        description: 'Read Thai conversation, broken down word by word.',
        lang: 'en',
        start_url: '/',
        display: 'standalone',
        background_color: '#fcfcfd',
        theme_color: '#fcfcfd',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    }),
  ],
  server: {
    proxy: apiProxy,
  },
  preview: {
    proxy: apiProxy,
  },
})
