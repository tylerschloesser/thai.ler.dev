import { beforeEach, describe, expect, it } from 'vitest'
import { createRecordsApi } from '../../_lib/records.js'
import { createStore } from '../../_lib/store/index.js'
import { resetMemoryStoreForTests } from '../../_lib/store/memory.js'
import { POST } from './rebuild.js'
import { jsonBody } from '../../_lib/jsonBody.js'

beforeEach(() => {
  resetMemoryStoreForTests()
  process.env['BLOB_BACKEND'] = 'memory'
  process.env['ALLOW_TEST_MODE'] = '1'
})

function request(cookie: string): Request {
  return new Request('http://localhost:3000/api/sync/manifest/rebuild', {
    method: 'POST',
    headers: { cookie },
  })
}

describe('POST /api/sync/manifest/rebuild', () => {
  it('rewrites the manifest from the actual stored records', async () => {
    const prefix = 'ns/rebuild-1/v1/'
    const records = createRecordsApi(createStore('memory'), prefix)
    await records.putRecords(
      [
        {
          kind: 'dialogue',
          id: 'd1',
          value: {
            id: 'd1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: null,
            title: 't',
            sourceText: 'A: hi',
            currentAnnotationId: null,
          },
        },
      ],
      { manifest: false }, // manifest not written yet
    )

    const before = await records.getManifest()
    expect(before.entries).toEqual({})

    const res = await POST(request('thai_ns=rebuild-1'))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.entries['dialogue:d1']).toBeDefined()
  })
})
