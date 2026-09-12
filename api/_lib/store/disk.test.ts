import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDiskStore } from './disk.js'
import { StorePreconditionError } from './paths.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'thai-disk-store-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('createDiskStore', () => {
  it('get on a missing path returns null', async () => {
    const store = createDiskStore({ root })
    expect(await store.getJson('nope.json')).toBeNull()
  })

  it('put then get round-trips the value', async () => {
    const store = createDiskStore({ root })
    await store.putJson('a.json', { hello: 'world' })
    const got = await store.getJson<{ hello: string }>('a.json')
    expect(got?.value).toEqual({ hello: 'world' })
  })

  it('creates nested directories as needed', async () => {
    const store = createDiskStore({ root })
    await store.putJson('dialogues/nested/1.json', { ok: true })
    const got = await store.getJson<{ ok: boolean }>('dialogues/nested/1.json')
    expect(got?.value).toEqual({ ok: true })
  })

  it('overwriting with different content changes the etag', async () => {
    const store = createDiskStore({ root })
    const first = await store.putJson('a.json', { n: 1 })
    const second = await store.putJson('a.json', { n: 2 })
    expect(second.etag).not.toBe(first.etag)
    const got = await store.getJson<{ n: number }>('a.json')
    expect(got?.etag).toBe(second.etag)
  })

  it('ifMatch with the current etag succeeds', async () => {
    const store = createDiskStore({ root })
    const first = await store.putJson('a.json', { n: 1 })
    await expect(
      store.putJson('a.json', { n: 2 }, { ifMatch: first.etag }),
    ).resolves.toMatchObject({})
  })

  it('ifMatch with a stale etag throws StorePreconditionError', async () => {
    const store = createDiskStore({ root })
    await store.putJson('a.json', { n: 1 })
    await expect(
      store.putJson('a.json', { n: 2 }, { ifMatch: 'stale-etag' }),
    ).rejects.toThrow(StorePreconditionError)
  })

  it('ifMatch on a missing path throws StorePreconditionError', async () => {
    const store = createDiskStore({ root })
    await expect(
      store.putJson('missing.json', { n: 1 }, { ifMatch: 'anything' }),
    ).rejects.toThrow(StorePreconditionError)
  })

  it('list filters by prefix and returns pathname + url', async () => {
    const store = createDiskStore({ root })
    await store.putJson('ns/a/v1/dialogues/1.json', {})
    await store.putJson('ns/a/v1/dialogues/2.json', {})
    await store.putJson('ns/b/v1/dialogues/1.json', {})
    const results = await store.list('ns/a/v1/')
    expect(results.map((r) => r.pathname).sort()).toEqual([
      'ns/a/v1/dialogues/1.json',
      'ns/a/v1/dialogues/2.json',
    ])
  })

  it('list on a store with no files yet returns empty (root need not exist)', async () => {
    const store = createDiskStore({ root: path.join(root, 'does-not-exist') })
    expect(await store.list('')).toEqual([])
  })

  it('del removes entries by the pathname/url returned from list', async () => {
    const store = createDiskStore({ root })
    await store.putJson('a.json', { n: 1 })
    const [entry] = await store.list('a.json')
    await store.del([entry!.url])
    expect(await store.getJson('a.json')).toBeNull()
  })

  it('del on a missing path is a no-op', async () => {
    const store = createDiskStore({ root })
    await expect(store.del(['nope.json'])).resolves.toBeUndefined()
  })

  it('persists across independent store instances against the same root', async () => {
    const store1 = createDiskStore({ root })
    await store1.putJson('a.json', { n: 1 })
    const store2 = createDiskStore({ root })
    expect(await store2.getJson('a.json')).toMatchObject({ value: { n: 1 } })
  })
})
