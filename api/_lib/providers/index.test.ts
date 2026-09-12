import { afterEach, describe, expect, it } from 'vitest'
import { createContext } from '../context.js'
import {
  createProvider,
  MissingApiKeyError,
  selectNewJobProvider,
} from './index.js'

function request(cookie?: string): Request {
  return new Request('http://localhost:3000/api/annotate', {
    headers: cookie ? { cookie } : {},
  })
}

describe('selectNewJobProvider', () => {
  const originalAllow = process.env['ALLOW_TEST_MODE']
  const originalModel = process.env['MODEL_PROVIDER']

  afterEach(() => {
    if (originalAllow === undefined) delete process.env['ALLOW_TEST_MODE']
    else process.env['ALLOW_TEST_MODE'] = originalAllow
    if (originalModel === undefined) delete process.env['MODEL_PROVIDER']
    else process.env['MODEL_PROVIDER'] = originalModel
  })

  it('uses thai_model when set in test mode', () => {
    process.env['ALLOW_TEST_MODE'] = '1'
    process.env['MODEL_PROVIDER'] = 'anthropic'
    const ctx = createContext(request('thai_model=fake-slow'))
    expect(selectNewJobProvider(ctx)).toBe('fake-slow')
  })

  it('falls back to env.MODEL_PROVIDER with no cookie', () => {
    process.env['ALLOW_TEST_MODE'] = '1'
    process.env['MODEL_PROVIDER'] = 'fake'
    const ctx = createContext(request())
    expect(selectNewJobProvider(ctx)).toBe('fake')
  })
})

describe('createProvider', () => {
  const originalKey = process.env['ANTHROPIC_API_KEY']

  afterEach(() => {
    if (originalKey === undefined) delete process.env['ANTHROPIC_API_KEY']
    else process.env['ANTHROPIC_API_KEY'] = originalKey
  })

  it('throws MissingApiKeyError for "anthropic" with no key configured', () => {
    delete process.env['ANTHROPIC_API_KEY']
    expect(() =>
      createProvider('anthropic', { fakeError: null, fakeDelayMs: null }),
    ).toThrow(MissingApiKeyError)
  })

  it('builds an anthropic provider when a key is configured', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test'
    const provider = createProvider('anthropic', {
      fakeError: null,
      fakeDelayMs: null,
    })
    expect(provider.name).toBe('anthropic')
  })

  it('builds a fake / fake-slow provider without needing a key', () => {
    delete process.env['ANTHROPIC_API_KEY']
    expect(
      createProvider('fake', { fakeError: null, fakeDelayMs: null }).name,
    ).toBe('fake')
    expect(
      createProvider('fake-slow', { fakeError: null, fakeDelayMs: null }).name,
    ).toBe('fake-slow')
  })
})
