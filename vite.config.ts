import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { apiPlugin } from './scripts/vite-api-plugin.ts'

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    apiPlugin(),
  ],
  // No envPrefix override (default: 'VITE_' only) - the client bundle must
  // never contain ANTHROPIC_API_KEY (PLAN.MD §4.6); the key lives only in
  // Vercel Functions' server-side process.env.
  css: { modules: { localsConvention: 'camelCaseOnly' } },
})
