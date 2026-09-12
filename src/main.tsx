import './styles/global.css'
import './styles/fonts'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { ToastProvider } from './ui/Toast'
import { Providers } from './app/providers'
import { router } from './app/router'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </Providers>
  </StrictMode>,
)
