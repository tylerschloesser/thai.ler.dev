import { beforeEach, describe, expect, it } from 'vitest'
import { LEGACY_RUN } from '../../src/lib/records.js'
import type { AnnotationRecord } from '../../src/lib/records.js'
import { createRecordsApi } from '../_lib/records.js'
import { createStore } from '../_lib/store/index.js'
import { resetMemoryStoreForTests } from '../_lib/store/memory.js'
import { POST } from './cancel.js'
import { jsonBody } from '../_lib/jsonBody.js'

const NS = 'cancel-test'
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
  await records.putRecords([{ kind: 'annotation', id: ann.id, value: ann }], {
    manifest: false,
  })
}

function request(id: string): Request {
  return new Request(`http://localhost:3000/api/annotation/cancel?id=${id}`, {
    method: 'POST',
    headers: { cookie: `thai_ns=${NS}` },
  })
}

beforeEach(() => {
  resetMemoryStoreForTests()
  process.env['BLOB_BACKEND'] = 'memory'
  process.env['ALLOW_TEST_MODE'] = '1'
})

describe('POST /api/annotation/cancel', () => {
  it('404s when the annotation does not exist', async () => {
    const res = await POST(request('nope'))
    expect(res.status).toBe(404)
  })

  it('sets run.state to cancelled and preserves finished lines', async () => {
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
          null,
        ],
        lineErrors: [null, null],
      }),
    )
    const res = await POST(request('a1'))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.run.state).toBe('cancelled')
    expect(body.run.leaseUntil).toBeNull()
    expect(body.status).toBe('partial')
    expect(body.lines[0]).not.toBeNull()
  })

  it('is a no-op for an already-done record', async () => {
    await seed(baseAnnotation({ run: { ...LEGACY_RUN, state: 'done' } }))
    const res = await POST(request('a1'))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.run.state).toBe('done')
  })
})
