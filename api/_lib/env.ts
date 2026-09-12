import type { BlobBackend } from './store/index.js'

/**
 * Typed, defaulted access to process.env for `api/**` handlers (PLAN.MD
 * §4.1, §4.9). Reads `process.env` directly - env vars are populated by
 * Vercel at runtime, or by `scripts/load-env.ts` + `scripts/vite-api-plugin.ts`
 * locally - `readEnv()` itself never reads `.env*` files.
 *
 * Provider *selection* (constructing the actual `LineProvider`) is M1; this
 * only resolves the default provider name so `GET /api/health` can report
 * it. The seam: callers read `env.MODEL_PROVIDER` and, once M1 lands, pass
 * it to `api/_lib/providers/index.ts`.
 */

export type ModelProvider = 'anthropic' | 'fake'

export interface Env {
  MODEL_PROVIDER: ModelProvider
  BLOB_BACKEND: BlobBackend
  ALLOW_TEST_MODE: boolean
  /** `undefined` only when running on Vercel with no `INTERNAL_SECRET` set. */
  INTERNAL_SECRET: string | undefined
  STEP_BUDGET_MS: number
  /** Only meaningful for `BLOB_BACKEND=disk`; lets `scripts/smoke-runner.ts` point a spawned preview at an isolated temp root. */
  BLOB_DISK_ROOT: string | undefined
}

const BLOB_BACKENDS = ['memory', 'disk', 'vercel'] as const

function isBlobBackend(value: string | undefined): value is BlobBackend {
  return (BLOB_BACKENDS as readonly string[]).includes(value ?? '')
}

function isModelProvider(value: string | undefined): value is ModelProvider {
  return value === 'anthropic' || value === 'fake'
}

/** True when the process is actually running as a Vercel Function. */
function isOnVercel(): boolean {
  return process.env['VERCEL'] === '1'
}

/**
 * Reads and defaults every env var the API layer needs. Throws if
 * `ALLOW_TEST_MODE=1` is ever set alongside `VERCEL_ENV=production` - test
 * mode must never be reachable in production (CLAUDE.md hard rule 3).
 */
export function readEnv(): Env {
  const allowTestMode = process.env['ALLOW_TEST_MODE'] === '1'
  if (allowTestMode && process.env['VERCEL_ENV'] === 'production') {
    throw new Error(
      'ALLOW_TEST_MODE=1 is never permitted when VERCEL_ENV=production',
    )
  }

  const explicitProvider = process.env['MODEL_PROVIDER']
  const modelProvider: ModelProvider = isModelProvider(explicitProvider)
    ? explicitProvider
    : process.env['ANTHROPIC_API_KEY']
      ? 'anthropic'
      : 'fake'

  const explicitBackend = process.env['BLOB_BACKEND']
  const blobBackend: BlobBackend = isBlobBackend(explicitBackend)
    ? explicitBackend
    : isOnVercel()
      ? 'vercel'
      : 'disk'

  const explicitSecret = process.env['INTERNAL_SECRET']
  const internalSecret =
    explicitSecret !== undefined
      ? explicitSecret
      : isOnVercel()
        ? undefined
        : 'local-dev'

  const explicitBudget = Number(process.env['STEP_BUDGET_MS'])
  const stepBudgetMs =
    Number.isFinite(explicitBudget) && explicitBudget > 0
      ? explicitBudget
      : 250_000

  return {
    MODEL_PROVIDER: modelProvider,
    BLOB_BACKEND: blobBackend,
    ALLOW_TEST_MODE: allowTestMode,
    INTERNAL_SECRET: internalSecret,
    STEP_BUDGET_MS: stepBudgetMs,
    BLOB_DISK_ROOT: process.env['BLOB_DISK_ROOT'],
  }
}
