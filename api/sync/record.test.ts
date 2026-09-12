import { beforeEach, describe, expect, it } from 'vitest'
import { LEGACY_RUN } from '../../src/lib/records.js'
import { createRecordsApi } from '../_lib/records.js'
import { createStore } from '../_lib/store/index.js'
import { resetMemoryStoreForTests } from '../_lib/store/memory.js'
import { GET, PUT } from './record.js'
import { jsonBody } from '../_lib/jsonBody.js'

const NS = 'record-test'

beforeEach(() => {
  resetMemoryStoreForTests()
  process.env['BLOB_BACKEND'] = 'memory'
  process.env['ALLOW_TEST_MODE'] = '1'
})

function getRequest(qs: string, ns = NS): Request {
  return new Request(`http://localhost:3000/api/sync/record?${qs}`, {
    headers: { cookie: `thai_ns=${ns}` },
  })
}

function putRequest(body: unknown, ns = NS): Request {
  return new Request('http://localhost:3000/api/sync/record', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: `thai_ns=${ns}` },
    body: JSON.stringify(body),
  })
}

describe('GET /api/sync/record', () => {
  it('400s for a settings id other than "all"', async () => {
    const res = await GET(getRequest('kind=settings&id=bogus', 'get-1'))
    expect(res.status).toBe(400)
  })

  it('returns [] for settings when none exist', async () => {
    const res = await GET(getRequest('kind=settings&id=all', 'get-2'))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.record).toEqual([])
  })

  it('404s for a missing dialogue', async () => {
    const res = await GET(getRequest('kind=dialogue&id=nope', 'get-3'))
    expect(res.status).toBe(404)
  })

  it('returns an existing annotation', async () => {
    const records = createRecordsApi(createStore('memory'), 'ns/get-4/v1/')
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
    const res = await GET(getRequest('kind=annotation&id=a1', 'get-4'))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.kind).toBe('annotation')
    expect(body.record.id).toBe('a1')
  })
})

function dialogueBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    title: 't',
    sourceText: 'A: hi',
    currentAnnotationId: null,
    ...overrides,
  }
}

describe('PUT /api/sync/record', () => {
  it('creates a new dialogue (no existing record to compare against)', async () => {
    const res = await PUT(
      putRequest({ kind: 'dialogue', record: dialogueBody() }, 'put-1'),
    )
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.record.id).toBe('d1')
  })

  it('an older incoming dialogue loses; the winner returned is the stored (newer) copy', async () => {
    const prefix = 'ns/put-2/v1/'
    const records = createRecordsApi(createStore('memory'), prefix)
    await records.putRecords(
      [
        {
          kind: 'dialogue',
          id: 'd1',
          value: dialogueBody({
            updatedAt: '2026-06-01T00:00:00.000Z',
            title: 'Newer',
          }) as never,
        },
      ],
      { manifest: true },
    )

    const res = await PUT(
      putRequest(
        {
          kind: 'dialogue',
          record: dialogueBody({
            updatedAt: '2020-01-01T00:00:00.000Z',
            title: 'Older',
          }),
        },
        'put-2',
      ),
    )
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.record.title).toBe('Newer')

    // The stale write never happened: the stored copy is still the newer one.
    const stillNewer = await records.getDialogue('d1')
    expect(stillNewer?.title).toBe('Newer')
  })

  it('settings PUT merges rows and returns the merged winner', async () => {
    const res1 = await PUT(
      putRequest(
        {
          kind: 'settings',
          record: [
            {
              key: 'model',
              value: 'claude-opus-5',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        'put-3',
      ),
    )
    expect(res1.status).toBe(200)

    const res2 = await PUT(
      putRequest(
        {
          kind: 'settings',
          record: [
            {
              key: 'theme',
              value: 'dark',
              updatedAt: '2026-01-02T00:00:00.000Z',
            },
          ],
        },
        'put-3',
      ),
    )
    const body2 = await jsonBody(res2)
    expect(body2.record).toHaveLength(2)
  })

  it('400s on a malformed body', async () => {
    const res = await PUT(
      putRequest({ kind: 'dialogue', record: { bogus: true } }, 'put-4'),
    )
    expect(res.status).toBe(400)
  })
})
