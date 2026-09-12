import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Polyfills indexedDB/IDBKeyRange/etc. onto globalThis so Dexie works
    // under the 'node' environment. Harmless for tests that don't touch it
    // (e.g. src/lib/ids.test.ts).
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/**/*.test.ts',
      'e2e/**/*.test.ts',
      'api/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    exclude: ['node_modules/**', 'dist/**', 'e2e/**/*.spec.ts'],
  },
})
