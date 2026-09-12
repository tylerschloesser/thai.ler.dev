import type { Env } from './env.js'
import { readEnv } from './env.js'
import type { BlobStore } from './store/index.js'
import { createStore, prefixFor } from './store/index.js'

/**
 * Per-request context every handler builds first (PLAN.MD §4.1). Test-mode
 * cookies (`thai_*`) are parsed - and validated - only when
 * `env.ALLOW_TEST_MODE` is true; otherwise they're ignored entirely, so a
 * stray cookie can never affect a production request.
 *
 * Provider selection is M1's job (`api/_lib/providers/index.ts`); this only
 * exposes `modelOverride`/`fakeError` as the seam it will read from.
 */
export interface RequestContext {
  env: Env
  testMode: boolean
  /** Validated `thai_ns` cookie value, or null (no namespace = the default `v1/` prefix). */
  ns: string | null
  /** `v1/` or `ns/<ns>/v1/`. */
  prefix: string
  store: BlobStore
  stepBudgetMs: number
  /** Validated `thai_model` cookie value. */
  modelOverride: 'fake' | 'fake-slow' | null
  /** Raw `thai_fake_error` cookie value (an `AnnotateErrorKind`, unvalidated here). */
  fakeError: string | null
  /** Validated `thai_fake_delay_ms` cookie value (0..60000), or null (provider default applies). */
  fakeDelayMs: number | null
  /** Raw `Cookie` header, restricted to `thai_*` pairs, for `hop()` to forward. */
  testCookie: string | null
  origin: string
}

const NS_RE = /^[a-z0-9-]{1,64}$/
const POSITIVE_INT_RE = /^[1-9][0-9]*$/
const NON_NEGATIVE_INT_RE = /^(0|[1-9][0-9]*)$/
const MAX_FAKE_DELAY_MS = 60_000

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key) out[key] = value
  }
  return out
}

export function createContext(request: Request): RequestContext {
  const env = readEnv()
  const cookieHeader = request.headers.get('cookie')
  const cookies =
    env.ALLOW_TEST_MODE && cookieHeader ? parseCookies(cookieHeader) : {}

  const rawNs = cookies['thai_ns']
  const ns = rawNs !== undefined && NS_RE.test(rawNs) ? rawNs : null

  const rawModel = cookies['thai_model']
  const modelOverride =
    rawModel === 'fake' || rawModel === 'fake-slow' ? rawModel : null

  const rawBudget = cookies['thai_step_budget_ms']
  const stepBudgetMs =
    rawBudget !== undefined && POSITIVE_INT_RE.test(rawBudget)
      ? Number(rawBudget)
      : env.STEP_BUDGET_MS

  const rawFakeError = cookies['thai_fake_error']
  const fakeError = rawFakeError !== undefined ? rawFakeError : null

  const rawFakeDelay = cookies['thai_fake_delay_ms']
  const fakeDelayMs =
    rawFakeDelay !== undefined &&
    NON_NEGATIVE_INT_RE.test(rawFakeDelay) &&
    Number(rawFakeDelay) <= MAX_FAKE_DELAY_MS
      ? Number(rawFakeDelay)
      : null

  let testCookie: string | null = null
  if (env.ALLOW_TEST_MODE && cookieHeader) {
    const kept = cookieHeader
      .split(';')
      .map((pair) => pair.trim())
      .filter((pair) => pair.startsWith('thai_'))
    if (kept.length > 0) testCookie = kept.join('; ')
  }

  return {
    env,
    testMode: env.ALLOW_TEST_MODE,
    ns,
    prefix: prefixFor(ns),
    store: createStore(env.BLOB_BACKEND, { diskRoot: env.BLOB_DISK_ROOT }),
    stepBudgetMs,
    modelOverride,
    fakeError,
    fakeDelayMs,
    testCookie,
    origin: new URL(request.url).origin,
  }
}
