import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createContext } from './context.js'

const ENV_KEYS = ['ALLOW_TEST_MODE', 'BLOB_BACKEND', 'VERCEL'] as const

let snapshot: Record<string, string | undefined>

beforeEach(() => {
  snapshot = {}
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key]
    delete process.env[key]
  }
  process.env['BLOB_BACKEND'] = 'memory'
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key]
    else process.env[key] = snapshot[key]
  }
})

function request(cookie?: string): Request {
  const headers = cookie ? { cookie } : {}
  return new Request('http://localhost:3000/api/health', { headers })
}

describe('createContext', () => {
  it('ignores every thai_* cookie when test mode is off', () => {
    process.env['ALLOW_TEST_MODE'] = '0'
    const ctx = createContext(
      request('thai_ns=my-ns; thai_model=fake; thai_step_budget_ms=1000'),
    )
    expect(ctx.testMode).toBe(false)
    expect(ctx.ns).toBeNull()
    expect(ctx.prefix).toBe('v1/')
    expect(ctx.modelOverride).toBeNull()
    expect(ctx.stepBudgetMs).toBe(250_000)
    expect(ctx.testCookie).toBeNull()
  })

  it('parses and validates cookies in test mode', () => {
    process.env['ALLOW_TEST_MODE'] = '1'
    const ctx = createContext(
      request(
        'thai_ns=e2e-abc; thai_model=fake-slow; thai_step_budget_ms=1500; thai_fake_error=rate_limited; other=1',
      ),
    )
    expect(ctx.testMode).toBe(true)
    expect(ctx.ns).toBe('e2e-abc')
    expect(ctx.prefix).toBe('ns/e2e-abc/v1/')
    expect(ctx.modelOverride).toBe('fake-slow')
    expect(ctx.stepBudgetMs).toBe(1500)
    expect(ctx.fakeError).toBe('rate_limited')
    expect(ctx.testCookie).toContain('thai_ns=e2e-abc')
    expect(ctx.testCookie).toContain('thai_model=fake-slow')
    expect(ctx.testCookie).not.toContain('other=1')
  })

  it('rejects an invalid thai_ns and falls back to no namespace', () => {
    process.env['ALLOW_TEST_MODE'] = '1'
    const ctx = createContext(request('thai_ns=Not_Valid!'))
    expect(ctx.ns).toBeNull()
    expect(ctx.prefix).toBe('v1/')
  })

  it('rejects an invalid thai_model', () => {
    process.env['ALLOW_TEST_MODE'] = '1'
    const ctx = createContext(request('thai_model=not-a-real-model'))
    expect(ctx.modelOverride).toBeNull()
  })

  it('rejects a non-positive-integer thai_step_budget_ms', () => {
    process.env['ALLOW_TEST_MODE'] = '1'
    const ctx = createContext(request('thai_step_budget_ms=-5'))
    expect(ctx.stepBudgetMs).toBe(250_000)
    const ctx2 = createContext(request('thai_step_budget_ms=abc'))
    expect(ctx2.stepBudgetMs).toBe(250_000)
  })

  it('testCookie is null when there are no thai_* cookies, even in test mode', () => {
    process.env['ALLOW_TEST_MODE'] = '1'
    const ctx = createContext(request('other=1'))
    expect(ctx.testCookie).toBeNull()
  })

  it('exposes the request origin', () => {
    const ctx = createContext(request())
    expect(ctx.origin).toBe('http://localhost:3000')
  })
})
