import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAnthropicClient, MissingApiKeyError } from './client'

describe('createAnthropicClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws MissingApiKeyError when no override and no env var are set', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect(() => createAnthropicClient()).toThrow(MissingApiKeyError)
    expect(() => createAnthropicClient(null)).toThrow(MissingApiKeyError)
  })

  it('prefers the explicit override over the env var', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'env-key')
    const client = createAnthropicClient('override-key')
    expect(client.apiKey).toBe('override-key')
  })

  it('falls back to the build-time env var when there is no override', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'env-key')
    const client = createAnthropicClient()
    expect(client.apiKey).toBe('env-key')
  })

  it('treats an empty-string override as absent and falls back to the env var', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'env-key')
    const client = createAnthropicClient('')
    expect(client.apiKey).toBe('env-key')
  })
})
