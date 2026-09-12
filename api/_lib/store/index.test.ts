import { beforeEach, describe, expect, it } from 'vitest'
import { createStore } from './index.js'
import { resetMemoryStoreForTests } from './memory.js'

beforeEach(() => {
  resetMemoryStoreForTests()
})

describe('createStore', () => {
  it('dispatches to the memory backend', async () => {
    const store = createStore('memory')
    await store.putJson('a.json', { n: 1 })
    expect(await store.getJson('a.json')).toMatchObject({ value: { n: 1 } })
  })

  it('dispatches to the disk backend with an overridden root', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const path = await import('node:path')
    const root = mkdtempSync(path.join(tmpdir(), 'thai-createstore-'))
    try {
      const store = createStore('disk', { diskRoot: root })
      await store.putJson('a.json', { n: 1 })
      expect(await store.getJson('a.json')).toMatchObject({ value: { n: 1 } })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('throws for an unknown backend', () => {
    // @ts-expect-error - deliberately invalid backend to test the runtime guard
    expect(() => createStore('bogus')).toThrow()
  })
})
