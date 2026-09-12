import { describe, expect, it } from 'vitest'
import { newId } from './ids'

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('newId', () => {
  it('returns a v4-shaped UUID', () => {
    expect(newId()).toMatch(UUID_V4_RE)
  })

  it('returns different values on each call', () => {
    expect(newId()).not.toBe(newId())
  })
})
