import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'e2e/**/*.spec.ts'],
  },
})
