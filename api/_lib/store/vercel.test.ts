import {
  BlobError,
  BlobNotFoundError,
  BlobPreconditionFailedError,
  put,
} from '@vercel/blob'
import { describe, expect, it, vi } from 'vitest'
import { StorePreconditionError } from './paths.js'
import { createVercelStore } from './vercel.js'

/**
 * Mocks `@vercel/blob` so the ifMatch-on-a-missing-blob error mapping can
 * be tested without `BLOB_READ_WRITE_TOKEN` (the real-network contract
 * test lives in `store.vercel.test.ts`, skipped without a token). Keeps
 * the real error classes via `importOriginal` so `instanceof` checks in
 * `vercel.ts` see genuine instances - only `put`/`get`/`list`/`del`
 * themselves are replaced.
 */
vi.mock('@vercel/blob', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vercel/blob')>()
  return {
    ...actual,
    put: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    del: vi.fn(),
  }
})

describe('createVercelStore putJson ifMatch error mapping', () => {
  it('maps BlobPreconditionFailedError to StorePreconditionError', async () => {
    vi.mocked(put).mockRejectedValueOnce(new BlobPreconditionFailedError())

    const store = createVercelStore()
    await expect(
      store.putJson('a.json', { n: 1 }, { ifMatch: 'stale' }),
    ).rejects.toThrow(StorePreconditionError)
  })

  it('maps the generic "does not exist" BlobError to StorePreconditionError', async () => {
    // Observed against the real preview store: put(..., { ifMatch }) on a
    // missing blob answers this generic BlobError, not
    // BlobPreconditionFailedError or BlobNotFoundError.
    vi.mocked(put).mockRejectedValueOnce(
      new BlobError('Vercel Blob: The specified key does not exist.'),
    )

    const store = createVercelStore()
    await expect(
      store.putJson('missing.json', { n: 1 }, { ifMatch: 'anything' }),
    ).rejects.toThrow(StorePreconditionError)
  })

  it('maps BlobNotFoundError to StorePreconditionError too', async () => {
    vi.mocked(put).mockRejectedValueOnce(new BlobNotFoundError())

    const store = createVercelStore()
    await expect(
      store.putJson('missing.json', { n: 1 }, { ifMatch: 'anything' }),
    ).rejects.toThrow(StorePreconditionError)
  })

  it('rethrows an unrelated BlobError untouched', async () => {
    vi.mocked(put).mockRejectedValueOnce(new BlobError('Some other failure'))

    const store = createVercelStore()
    await expect(
      store.putJson('a.json', { n: 1 }, { ifMatch: 'anything' }),
    ).rejects.toThrow('Some other failure')
  })

  it('rethrows an unrelated error when no ifMatch was given', async () => {
    vi.mocked(put).mockRejectedValueOnce(new BlobError('network blip'))

    const store = createVercelStore()
    await expect(store.putJson('a.json', { n: 1 })).rejects.toThrow(
      'network blip',
    )
  })
})
