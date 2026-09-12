import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { getSetting, setSetting, SETTINGS_DEFAULTS } from './settings'

beforeEach(async () => {
  await db.settings.clear()
})

describe('settings', () => {
  it('returns the documented default for every key before any row exists', async () => {
    for (const key of Object.keys(SETTINGS_DEFAULTS) as Array<
      keyof typeof SETTINGS_DEFAULTS
    >) {
      expect(await getSetting(key)).toEqual(SETTINGS_DEFAULTS[key])
    }
  })

  it('setSetting persists a value that getSetting then returns', async () => {
    await setSetting('theme', 'dark')
    expect(await getSetting('theme')).toBe('dark')

    await setSetting('thaiFontScale', 1.25)
    expect(await getSetting('thaiFontScale')).toBe(1.25)

    await setSetting('apiKeyOverride', 'sk-test')
    expect(await getSetting('apiKeyOverride')).toBe('sk-test')
  })
})
