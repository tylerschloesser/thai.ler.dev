import { beforeEach, describe, expect, it } from 'vitest'
import { LEGACY_RUN } from '../src/lib/records.js'
import { createRecordsApi } from './_lib/records.js'
import { resetMemoryStoreForTests } from './_lib/store/memory.js'
import { GET } from './annotation.js'
import { jsonBody } from './_lib/jsonBody.js'

beforeEach(() => {
  resetMemoryStoreForTests()
  process.env['BLOB_BACKEND'] = 'memory'
  process.env['ALLOW_TEST_MODE'] = '1'
})

function request(url: string, cookie?: string): Request {
  return new Request(url, { headers: cookie ? { cookie } : {} })
}

describe('GET /api/annotation', () => {
  it('404s when id is missing', async () => {
    const res = await GET(request('http://localhost:3000/api/annotation'))
    expect(res.status).toBe(400)
  })

  it('404s when the annotation does not exist', async () => {
    const res = await GET(
      request('http://localhost:3000/api/annotation?id=nope'),
    )
    expect(res.status).toBe(404)
    const body = await jsonBody(res)
    expect(body.error.kind).toBe('not_found')
  })

  it('returns the stored annotation record', async () => {
    const records = createRecordsApi(
      (await import('./_lib/store/index.js')).createStore('memory'),
      'ns/ann-get-1/v1/',
    )
    await records.putRecords(
      [
        {
          kind: 'annotation',
          id: 'a1',
          value: {
            id: 'a1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: null,
            dialogueId: 'd1',
            model: 'claude-opus-5',
            promptVersion: 2,
            schemaVersion: 1,
            lines: [null],
            lineErrors: [null],
            status: 'partial',
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
            durationMs: 0,
            run: LEGACY_RUN,
          },
        },
      ],
      { manifest: false },
    )

    const res = await GET(
      request(
        'http://localhost:3000/api/annotation?id=a1',
        'thai_ns=ann-get-1',
      ),
    )
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.id).toBe('a1')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })
})
