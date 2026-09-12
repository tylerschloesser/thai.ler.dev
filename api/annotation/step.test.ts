import { beforeEach, describe, expect, it } from 'vitest'
import { LEGACY_RUN } from '../../src/lib/records.js'
import type { AnnotationRecord } from '../../src/lib/records.js'
import { createRecordsApi } from '../_lib/records.js'
import { createStore } from '../_lib/store/index.js'
import { resetMemoryStoreForTests } from '../_lib/store/memory.js'
import { POST } from './step.js'

const NS = 'step-test'
const PREFIX = `ns/${NS}/v1/`

function baseAnnotation(
  overrides: Partial<AnnotationRecord> = {},
): AnnotationRecord {
  return {
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
    run: { ...LEGACY_RUN, state: 'running' },
    ...overrides,
  }
}

async function seed(ann: AnnotationRecord): Promise<void> {
  const records = createRecordsApi(createStore('memory'), PREFIX)
  await records.putRecords(
    [
      { kind: 'annotation', id: ann.id, value: ann },
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
          currentAnnotationId: 'a1',
        },
      },
    ],
    { manifest: false },
  )
}

function request(id: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000/api/annotation/step?id=${id}`, {
    method: 'POST',
    headers: { cookie: `thai_ns=${NS}`, ...headers },
  })
}

beforeEach(() => {
  resetMemoryStoreForTests()
  process.env['BLOB_BACKEND'] = 'memory'
  process.env['ALLOW_TEST_MODE'] = '1'
  process.env['MODEL_PROVIDER'] = 'fake'
  process.env['INTERNAL_SECRET'] = 'test-secret'
})

describe('POST /api/annotation/step', () => {
  it('401s without the x-thai-internal header', async () => {
    await seed(baseAnnotation())
    const res = await POST(request('a1'))
    expect(res.status).toBe(401)
  })

  it('401s with the wrong secret', async () => {
    await seed(baseAnnotation())
    const res = await POST(request('a1', { 'x-thai-internal': 'wrong' }))
    expect(res.status).toBe(401)
  })

  it('404s when the annotation does not exist', async () => {
    const res = await POST(
      request('nope', { 'x-thai-internal': 'test-secret' }),
    )
    expect(res.status).toBe(404)
  })

  it('increments hops and returns 202 with the right secret', async () => {
    await seed(
      baseAnnotation({ run: { ...LEGACY_RUN, state: 'running', hops: 1 } }),
    )
    const res = await POST(request('a1', { 'x-thai-internal': 'test-secret' }))
    expect(res.status).toBe(202)

    const records = createRecordsApi(createStore('memory'), PREFIX)
    const after = await records.getAnnotation('a1')
    expect(after?.run.hops).toBe(2)
  })

  it('409s when hops >= MAX_HOPS', async () => {
    await seed(
      baseAnnotation({ run: { ...LEGACY_RUN, state: 'running', hops: 3 } }),
    )
    const res = await POST(request('a1', { 'x-thai-internal': 'test-secret' }))
    expect(res.status).toBe(409)
  })
})
