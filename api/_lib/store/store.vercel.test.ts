import { del as blobDel, list as blobList } from '@vercel/blob'
import { afterAll, describe, expect, it } from 'vitest'
import { createVercelStore } from './vercel.js'
import { StorePreconditionError } from './paths.js'

/**
 * Exercises the real Vercel Blob backend with the same contract as
 * `memory.test.ts`/`disk.test.ts`. Skipped unless `BLOB_READ_WRITE_TOKEN`
 * is set (PLAN.MD §5 M0 item 4) - CI and most local runs never hit the
 * network here. Uses a random namespace prefix and deletes everything it
 * wrote in `afterAll` so it never leaves data behind or collides with a
 * concurrent run (`.claude/rules/deploy.md` Hobby Blob budget).
 */
const hasToken = Boolean(process.env['BLOB_READ_WRITE_TOKEN'])

describe.skipIf(!hasToken)('createVercelStore (real Blob)', () => {
  const prefix = `ns/vitest-${Math.random().toString(36).slice(2)}/v1/`

  afterAll(async () => {
    const { blobs } = await blobList({ prefix })
    if (blobs.length > 0) {
      await blobDel(blobs.map((b) => b.url))
    }
  })

  it('get on a missing path returns null', async () => {
    const store = createVercelStore()
    expect(await store.getJson(`${prefix}nope.json`)).toBeNull()
  })

  it('put then get round-trips the value', async () => {
    const store = createVercelStore()
    await store.putJson(`${prefix}a.json`, { hello: 'world' })
    const got = await store.getJson<{ hello: string }>(`${prefix}a.json`)
    expect(got?.value).toEqual({ hello: 'world' })
  })

  it('overwriting changes the etag', async () => {
    const store = createVercelStore()
    const first = await store.putJson(`${prefix}b.json`, { n: 1 })
    const second = await store.putJson(`${prefix}b.json`, { n: 2 })
    expect(second.etag).not.toBe(first.etag)
  })

  it('ifMatch with the current etag succeeds', async () => {
    const store = createVercelStore()
    const first = await store.putJson(`${prefix}c.json`, { n: 1 })
    await expect(
      store.putJson(`${prefix}c.json`, { n: 2 }, { ifMatch: first.etag }),
    ).resolves.toMatchObject({})
  })

  it('ifMatch with a stale etag throws StorePreconditionError', async () => {
    const store = createVercelStore()
    await store.putJson(`${prefix}d.json`, { n: 1 })
    await expect(
      store.putJson(`${prefix}d.json`, { n: 2 }, { ifMatch: 'stale-etag' }),
    ).rejects.toThrow(StorePreconditionError)
  })

  it('ifMatch on a missing path throws StorePreconditionError', async () => {
    const store = createVercelStore()
    await expect(
      store.putJson(`${prefix}missing.json`, { n: 1 }, { ifMatch: 'x' }),
    ).rejects.toThrow(StorePreconditionError)
  })

  it('list filters by prefix', async () => {
    const store = createVercelStore()
    await store.putJson(`${prefix}dialogues/1.json`, {})
    const results = await store.list(`${prefix}dialogues/`)
    expect(results.map((r) => r.pathname)).toContain(
      `${prefix}dialogues/1.json`,
    )
  })

  it('del removes the blob', async () => {
    const store = createVercelStore()
    await store.putJson(`${prefix}e.json`, { n: 1 })
    const results = await store.list(`${prefix}e.json`)
    await store.del(results.map((r) => r.url))
    expect(await store.getJson(`${prefix}e.json`)).toBeNull()
  })
})
