import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readEnv } from './env.js'

const ENV_KEYS = [
  'VERCEL',
  'VERCEL_ENV',
  'ALLOW_TEST_MODE',
  'MODEL_PROVIDER',
  'ANTHROPIC_API_KEY',
  'BLOB_BACKEND',
  'INTERNAL_SECRET',
  'STEP_BUDGET_MS',
  'BLOB_DISK_ROOT',
] as const

let snapshot: Record<string, string | undefined>

beforeEach(() => {
  snapshot = {}
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key]
    else process.env[key] = snapshot[key]
  }
})

describe('readEnv', () => {
  it('defaults MODEL_PROVIDER to fake with no key and no override', () => {
    expect(readEnv().MODEL_PROVIDER).toBe('fake')
  })

  it('defaults MODEL_PROVIDER to anthropic when ANTHROPIC_API_KEY is set', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test'
    expect(readEnv().MODEL_PROVIDER).toBe('anthropic')
  })

  it('an explicit MODEL_PROVIDER wins over the key-based default', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test'
    process.env['MODEL_PROVIDER'] = 'fake'
    expect(readEnv().MODEL_PROVIDER).toBe('fake')
  })

  it('defaults BLOB_BACKEND to disk off Vercel', () => {
    expect(readEnv().BLOB_BACKEND).toBe('disk')
  })

  it('defaults BLOB_BACKEND to vercel when VERCEL=1', () => {
    process.env['VERCEL'] = '1'
    expect(readEnv().BLOB_BACKEND).toBe('vercel')
  })

  it('an explicit BLOB_BACKEND wins over the VERCEL-based default', () => {
    process.env['VERCEL'] = '1'
    process.env['BLOB_BACKEND'] = 'memory'
    expect(readEnv().BLOB_BACKEND).toBe('memory')
  })

  it('ALLOW_TEST_MODE is true only for the literal string "1"', () => {
    expect(readEnv().ALLOW_TEST_MODE).toBe(false)
    process.env['ALLOW_TEST_MODE'] = 'true'
    expect(readEnv().ALLOW_TEST_MODE).toBe(false)
    process.env['ALLOW_TEST_MODE'] = '1'
    expect(readEnv().ALLOW_TEST_MODE).toBe(true)
  })

  it('throws when ALLOW_TEST_MODE=1 and VERCEL_ENV=production', () => {
    process.env['ALLOW_TEST_MODE'] = '1'
    process.env['VERCEL_ENV'] = 'production'
    expect(() => readEnv()).toThrow()
  })

  it('does not throw for ALLOW_TEST_MODE=1 outside production', () => {
    process.env['ALLOW_TEST_MODE'] = '1'
    process.env['VERCEL_ENV'] = 'preview'
    expect(() => readEnv()).not.toThrow()
  })

  it('INTERNAL_SECRET defaults to local-dev off Vercel', () => {
    expect(readEnv().INTERNAL_SECRET).toBe('local-dev')
  })

  it('INTERNAL_SECRET is undefined on Vercel with nothing set', () => {
    process.env['VERCEL'] = '1'
    expect(readEnv().INTERNAL_SECRET).toBeUndefined()
  })

  it('an explicit INTERNAL_SECRET always wins', () => {
    process.env['VERCEL'] = '1'
    process.env['INTERNAL_SECRET'] = 'super-secret'
    expect(readEnv().INTERNAL_SECRET).toBe('super-secret')
  })

  it('STEP_BUDGET_MS defaults to 250000', () => {
    expect(readEnv().STEP_BUDGET_MS).toBe(250_000)
  })

  it('STEP_BUDGET_MS reads a positive override', () => {
    process.env['STEP_BUDGET_MS'] = '1500'
    expect(readEnv().STEP_BUDGET_MS).toBe(1500)
  })

  it('an invalid STEP_BUDGET_MS falls back to the default', () => {
    process.env['STEP_BUDGET_MS'] = 'not-a-number'
    expect(readEnv().STEP_BUDGET_MS).toBe(250_000)
    process.env['STEP_BUDGET_MS'] = '-5'
    expect(readEnv().STEP_BUDGET_MS).toBe(250_000)
  })

  it('BLOB_DISK_ROOT is undefined by default and passes through when set', () => {
    expect(readEnv().BLOB_DISK_ROOT).toBeUndefined()
    process.env['BLOB_DISK_ROOT'] = '/tmp/thai-smoke'
    expect(readEnv().BLOB_DISK_ROOT).toBe('/tmp/thai-smoke')
  })
})
