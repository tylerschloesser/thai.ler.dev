import { describe, expect, it } from 'vitest'
import { lookupTone } from './tone'

describe('lookupTone', () => {
  it('mid class, live syllable, no tone mark -> mid', () => {
    expect(lookupTone('mid', 'live', 'none')).toBe('mid')
  })

  it('high class, live syllable, no tone mark -> rising', () => {
    expect(lookupTone('high', 'live', 'none')).toBe('rising')
  })

  it('low class, live syllable, no tone mark -> mid', () => {
    expect(lookupTone('low', 'live', 'none')).toBe('mid')
  })

  it('low class, dead syllable, short vowel, no tone mark -> high', () => {
    expect(lookupTone('low', 'dead', 'none', 'short')).toBe('high')
  })

  it('low class, dead syllable, long vowel, no tone mark -> falling', () => {
    expect(lookupTone('low', 'dead', 'none', 'long')).toBe('falling')
  })

  it('low class, live syllable, mai tho -> high', () => {
    expect(lookupTone('low', 'live', 'mai_tho')).toBe('high')
  })

  it('mid class, live syllable, mai tri -> high', () => {
    expect(lookupTone('mid', 'live', 'mai_tri')).toBe('high')
  })

  it('returns null for a combination that does not occur in Thai', () => {
    expect(lookupTone('low', 'live', 'mai_chattawa')).toBeNull()
  })
})
