import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { RouterProvider } from '@tanstack/react-router'
import { registerSW } from 'virtual:pwa-register'
import './styles/global.css'
import { persister, queryClient } from './db/queryClient.ts'
import { router } from './router.tsx'

// Serves the app shell offline. Without it the persisted query cache is
// unreachable on a cold start — the app never loads to read it.
registerSW({ immediate: true })

/**
 * PersistQueryClientProvider holds the first render until the IndexedDB cache
 * has been restored — that wait is precisely what makes an offline cold start
 * show real data instead of an empty app that then fills in.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>,
)
