import { describe, expect, it } from 'vitest'
import {
  isValidNamespace,
  manifestPath,
  prefixFor,
  recordPath,
  settingsPath,
} from './paths.js'

describe('isValidNamespace', () => {
  it('accepts lowercase alphanumeric + hyphen, 1-64 chars', () => {
    expect(isValidNamespace('e2e-abc123')).toBe(true)
    expect(isValidNamespace('a')).toBe(true)
    expect(isValidNamespace('a'.repeat(64))).toBe(true)
  })

  it('rejects uppercase, underscores, empty, and too-long strings', () => {
    expect(isValidNamespace('Abc')).toBe(false)
    expect(isValidNamespace('a_b')).toBe(false)
    expect(isValidNamespace('')).toBe(false)
    expect(isValidNamespace('a'.repeat(65))).toBe(false)
  })
})

describe('prefixFor', () => {
  it('is v1/ for no namespace', () => {
    expect(prefixFor(null)).toBe('v1/')
  })

  it('is ns/<ns>/v1/ for a valid namespace', () => {
    expect(prefixFor('e2e-abc')).toBe('ns/e2e-abc/v1/')
  })

  it('throws for an invalid namespace', () => {
    expect(() => prefixFor('Not Valid')).toThrow()
  })
})

describe('path builders', () => {
  const prefix = prefixFor('e2e-abc')

  it('manifestPath', () => {
    expect(manifestPath(prefix)).toBe('ns/e2e-abc/v1/manifest.json')
  })

  it('recordPath pluralizes the kind', () => {
    expect(recordPath(prefix, 'dialogue', 'd1')).toBe(
      'ns/e2e-abc/v1/dialogues/d1.json',
    )
    expect(recordPath(prefix, 'annotation', 'a1')).toBe(
      'ns/e2e-abc/v1/annotations/a1.json',
    )
  })

  it('settingsPath', () => {
    expect(settingsPath(prefix)).toBe('ns/e2e-abc/v1/settings.json')
  })
})
