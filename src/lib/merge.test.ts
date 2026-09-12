import { describe, expect, it } from 'vitest'
import { mergeSettingRows, pickWinner, settingsUpdatedAt } from './merge.js'
import type { Mergeable } from './merge.js'
import type { SettingRow } from './records.js'

// Adapted from the `pickWinner`/`mergeSnapshot` cases in
// `src/db/snapshot.test.ts` (pre-extraction), called directly against
// `pickWinner` here since it moved to this pure, generic module.

function record(overrides: Partial<Mergeable> = {}): Mergeable {
  return {
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

describe('pickWinner', () => {
  it('picks incoming when it is newer (last-writer-wins)', () => {
    const local = record({ updatedAt: '2026-01-01T00:00:00.000Z' })
    const incoming = record({ updatedAt: '2026-01-02T00:00:00.000Z' })
    expect(pickWinner(local, incoming)).toBe('incoming')
  })

  it('picks local when incoming is older', () => {
    const local = record({ updatedAt: '2026-01-02T00:00:00.000Z' })
    const incoming = record({ updatedAt: '2026-01-01T00:00:00.000Z' })
    expect(pickWinner(local, incoming)).toBe('local')
  })

  it('a tombstone beats a same-timestamp live record, regardless of side', () => {
    const ts = '2026-01-01T00:00:00.000Z'
    const local = record({ updatedAt: ts, deletedAt: null })
    const incoming = record({ updatedAt: ts, deletedAt: ts })
    expect(pickWinner(local, incoming)).toBe('incoming')

    const localTombstone = record({ updatedAt: ts, deletedAt: ts })
    const incomingLive = record({ updatedAt: ts, deletedAt: null })
    expect(pickWinner(localTombstone, incomingLive)).toBe('local')
  })

  it('at the same timestamp with neither (or both) a tombstone, local wins', () => {
    const ts = '2026-01-01T00:00:00.000Z'
    expect(
      pickWinner(
        record({ updatedAt: ts, deletedAt: null }),
        record({ updatedAt: ts, deletedAt: null }),
      ),
    ).toBe('local')
    expect(
      pickWinner(
        record({ updatedAt: ts, deletedAt: ts }),
        record({ updatedAt: ts, deletedAt: ts }),
      ),
    ).toBe('local')
  })

  it('does not resurrect a tombstone via an older live copy', () => {
    const local = record({
      updatedAt: '2026-01-05T00:00:00.000Z',
      deletedAt: '2026-01-05T00:00:00.000Z',
    })
    const incoming = record({
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    })
    expect(pickWinner(local, incoming)).toBe('local')
  })
})

function settingRow(overrides: Partial<SettingRow> = {}): SettingRow {
  return {
    key: 'theme',
    value: 'dark',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('mergeSettingRows', () => {
  it('adds a key that only exists in incoming', () => {
    const local = [settingRow({ key: 'theme' })]
    const incoming = [settingRow({ key: 'model', value: 'claude-opus-5' })]
    const merged = mergeSettingRows(local, incoming)
    expect(merged.map((r) => r.key)).toEqual(['model', 'theme'])
  })

  it('newer incoming wins for the same key', () => {
    const local = [
      settingRow({
        key: 'theme',
        value: 'light',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ]
    const incoming = [
      settingRow({
        key: 'theme',
        value: 'dark',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    ]
    const merged = mergeSettingRows(local, incoming)
    expect(merged).toEqual(incoming)
  })

  it('older incoming loses for the same key', () => {
    const local = [
      settingRow({
        key: 'theme',
        value: 'light',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    ]
    const incoming = [
      settingRow({
        key: 'theme',
        value: 'dark',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ]
    const merged = mergeSettingRows(local, incoming)
    expect(merged).toEqual(local)
  })

  it('a tie keeps local', () => {
    const ts = '2026-01-01T00:00:00.000Z'
    const local = [settingRow({ key: 'theme', value: 'light', updatedAt: ts })]
    const incoming = [
      settingRow({ key: 'theme', value: 'dark', updatedAt: ts }),
    ]
    const merged = mergeSettingRows(local, incoming)
    expect(merged).toEqual(local)
  })

  it('sorts the merged output by key', () => {
    const local = [settingRow({ key: 'theme' })]
    const incoming = [
      settingRow({ key: 'apiKeyOverride' }),
      settingRow({ key: 'model' }),
    ]
    const merged = mergeSettingRows(local, incoming)
    expect(merged.map((r) => r.key)).toEqual([
      'apiKeyOverride',
      'model',
      'theme',
    ])
  })
})

describe('settingsUpdatedAt', () => {
  it('returns the max updatedAt across rows', () => {
    const rows = [
      settingRow({ key: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }),
      settingRow({ key: 'b', updatedAt: '2026-01-03T00:00:00.000Z' }),
      settingRow({ key: 'c', updatedAt: '2026-01-02T00:00:00.000Z' }),
    ]
    expect(settingsUpdatedAt(rows, 'fallback')).toBe('2026-01-03T00:00:00.000Z')
  })

  it('returns the fallback for an empty array', () => {
    expect(settingsUpdatedAt([], '2026-01-01T00:00:00.000Z')).toBe(
      '2026-01-01T00:00:00.000Z',
    )
  })
})
