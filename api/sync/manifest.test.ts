import { beforeEach, describe, expect, it } from 'vitest'
import { createRecordsApi } from '../_lib/records.js'
import { createStore } from '../_lib/store/index.js'
import { resetMemoryStoreForTests } from '../_lib/store/memory.js'
import { GET } from './manifest.js'
import { jsonBody } from '../_lib/jsonBody.js'

beforeEach(() => {
  resetMemoryStoreForTests()
  process.env['BLOB_BACKEND'] = 'memory'
  process.env['ALLOW_TEST_MODE'] = '1'
})

function request(cookie: string): Request {
  return new Request('http://localhost:3000/api/sync/manifest', {
    headers: { cookie },
  })
}

describe('GET /api/sync/manifest', () => {
  it('returns an empty manifest when none exists, without writing one', async () => {
    const res = await GET(request('thai_ns=manifest-empty'))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.entries).toEqual({})

    const records = createRecordsApi(
      createStore('memory'),
      'ns/manifest-empty/v1/',
    )
    const listed = await createStore('memory').list('ns/manifest-empty/v1/')
    expect(listed).toEqual([])
    void records
  })

  it('reflects entries once records exist', async () => {
    const records = createRecordsApi(createStore('memory'), 'ns/manifest-2/v1/')
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
      { manifest: true },
    )

    const res = await GET(request('thai_ns=manifest-2'))
    const body = await jsonBody(res)
    expect(body.entries['dialogue:d1']).toBeDefined()
  })
})
