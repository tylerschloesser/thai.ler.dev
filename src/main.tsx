import './styles/global.css'
import './styles/fonts'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { ToastProvider } from './ui/Toast'
import { Providers } from './app/providers'
import { router } from './app/router'
import { installDebug } from './app/debug'

// Exposes window.__thai = { db, importSnapshot, exportSnapshot } before the
// app mounts - always on (not test-only), since e2e seeding depends on it.
installDebug()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </Providers>
  </StrictMode>,
)
