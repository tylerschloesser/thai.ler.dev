import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryStore, resetMemoryStoreForTests } from './memory.js'
import { StorePreconditionError } from './paths.js'

beforeEach(() => {
  resetMemoryStoreForTests()
})

describe('createMemoryStore', () => {
  it('get on a missing path returns null', async () => {
    const store = createMemoryStore()
    expect(await store.getJson('nope.json')).toBeNull()
  })

  it('put then get round-trips the value', async () => {
    const store = createMemoryStore()
    await store.putJson('a.json', { hello: 'world' })
    const got = await store.getJson<{ hello: string }>('a.json')
    expect(got?.value).toEqual({ hello: 'world' })
  })

  it('overwriting changes the etag', async () => {
    const store = createMemoryStore()
    const first = await store.putJson('a.json', { n: 1 })
    const second = await store.putJson('a.json', { n: 2 })
    expect(second.etag).not.toBe(first.etag)
    const got = await store.getJson<{ n: number }>('a.json')
    expect(got?.etag).toBe(second.etag)
    expect(got?.value).toEqual({ n: 2 })
  })

  it('ifMatch with the current etag succeeds', async () => {
    const store = createMemoryStore()
    const first = await store.putJson('a.json', { n: 1 })
    await expect(
      store.putJson('a.json', { n: 2 }, { ifMatch: first.etag }),
    ).resolves.toMatchObject({})
  })

  it('ifMatch with a stale etag throws StorePreconditionError', async () => {
    const store = createMemoryStore()
    await store.putJson('a.json', { n: 1 })
    await expect(
      store.putJson('a.json', { n: 2 }, { ifMatch: 'stale-etag' }),
    ).rejects.toThrow(StorePreconditionError)
  })

  it('ifMatch on a missing path throws StorePreconditionError', async () => {
    const store = createMemoryStore()
    await expect(
      store.putJson('missing.json', { n: 1 }, { ifMatch: 'anything' }),
    ).rejects.toThrow(StorePreconditionError)
  })

  it('list filters by prefix and returns pathname + url', async () => {
    const store = createMemoryStore()
    await store.putJson('ns/a/v1/dialogues/1.json', {})
    await store.putJson('ns/a/v1/dialogues/2.json', {})
    await store.putJson('ns/b/v1/dialogues/1.json', {})
    const results = await store.list('ns/a/v1/')
    expect(results.map((r) => r.pathname).sort()).toEqual([
      'ns/a/v1/dialogues/1.json',
      'ns/a/v1/dialogues/2.json',
    ])
    expect(results[0]?.url).toMatch(/^memory:\/\//)
  })

  it('del removes entries by the url returned from list/put', async () => {
    const store = createMemoryStore()
    await store.putJson('a.json', { n: 1 })
    const [entry] = await store.list('a.json')
    await store.del([entry!.url])
    expect(await store.getJson('a.json')).toBeNull()
  })

  it('survives module re-evaluation because the Map lives on globalThis', async () => {
    const store1 = createMemoryStore()
    await store1.putJson('a.json', { n: 1 })
    // Simulates a fresh module instance (e.g. tsImport re-evaluating the
    // module on every preview request) by calling the factory again.
    const store2 = createMemoryStore()
    expect(await store2.getJson('a.json')).toMatchObject({ value: { n: 1 } })
  })
})
