import { beforeEach, describe, expect, it } from 'vitest'
import { LEGACY_RUN } from '../../src/lib/records.js'
import type { AnnotationRecord } from '../../src/lib/records.js'
import { createRecordsApi } from '../_lib/records.js'
import { createStore } from '../_lib/store/index.js'
import { resetMemoryStoreForTests } from '../_lib/store/memory.js'
import { POST } from './resume.js'
import { jsonBody } from '../_lib/jsonBody.js'

const NS = 'resume-test'
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
    run: LEGACY_RUN,
    ...overrides,
  }
}

async function seed(ann: AnnotationRecord): Promise<void> {
  const records = createRecordsApi(createStore('memory'), PREFIX)
  await records.putRecords([{ kind: 'annotation', id: ann.id, value: ann }], {
    manifest: false,
  })
  // dialogue is needed by the background runStep call
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
          currentAnnotationId: 'a1',
        },
      },
    ],
    { manifest: false },
  )
}

function request(id: string): Request {
  return new Request(`http://localhost:3000/api/annotation/resume?id=${id}`, {
    method: 'POST',
    headers: { cookie: `thai_ns=${NS}` },
  })
}

beforeEach(() => {
  resetMemoryStoreForTests()
  process.env['BLOB_BACKEND'] = 'memory'
  process.env['ALLOW_TEST_MODE'] = '1'
  process.env['MODEL_PROVIDER'] = 'fake'
})

describe('POST /api/annotation/resume', () => {
  it('404s when the annotation does not exist', async () => {
    const res = await POST(request('nope'))
    expect(res.status).toBe(404)
  })

  it('409s when the lease is still live', async () => {
    await seed(
      baseAnnotation({
        run: {
          ...LEGACY_RUN,
          state: 'running',
          leaseUntil: new Date(Date.now() + 60_000).toISOString(),
        },
      }),
    )
    const res = await POST(request('a1'))
    expect(res.status).toBe(409)
  })

  it('409s when there are no null lines to resume', async () => {
    await seed(
      baseAnnotation({
        lines: [
          {
            speaker: null,
            thai: 'x',
            translation: 'x',
            sentences: [],
            notes: [],
          },
        ],
        status: 'complete',
        run: { ...LEGACY_RUN, state: 'done' },
      }),
    )
    const res = await POST(request('a1'))
    expect(res.status).toBe(409)
  })

  it('202s and starts a new lineage (hops: 0, state: queued) for a done/partial record', async () => {
    await seed(
      baseAnnotation({
        status: 'partial',
        run: { ...LEGACY_RUN, state: 'done', hops: 2 },
      }),
    )
    const res = await POST(request('a1'))
    expect(res.status).toBe(202)
    const body = await jsonBody(res)
    expect(body.run.state).toBe('queued')
    expect(body.run.hops).toBe(0)
  })

  it('202s for a cancelled record with null lines', async () => {
    await seed(
      baseAnnotation({ run: { ...LEGACY_RUN, state: 'cancelled', hops: 1 } }),
    )
    const res = await POST(request('a1'))
    expect(res.status).toBe(202)
    const body = await jsonBody(res)
    expect(body.run.state).toBe('queued')
    expect(body.run.hops).toBe(0)
  })
})
