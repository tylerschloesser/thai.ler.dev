import { beforeEach, describe, expect, it } from 'vitest'
import { LEGACY_RUN } from '../../src/lib/records.js'
import { createRecordsApi } from '../_lib/records.js'
import { createStore } from '../_lib/store/index.js'
import { resetMemoryStoreForTests } from '../_lib/store/memory.js'
import { POST } from './seed.js'
import { jsonBody } from '../_lib/jsonBody.js'

beforeEach(() => {
  resetMemoryStoreForTests()
  process.env['BLOB_BACKEND'] = 'memory'
})

function request(body: unknown, cookie: string, allowTestMode = true): Request {
  if (allowTestMode) process.env['ALLOW_TEST_MODE'] = '1'
  else delete process.env['ALLOW_TEST_MODE']
  return new Request('http://localhost:3000/api/test/seed', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}

describe('POST /api/test/seed', () => {
  it('404s when test mode is off', async () => {
    const res = await POST(
      request(
        { dialogues: [], annotations: [], settings: [] },
        'thai_ns=seed-1',
        false,
      ),
    )
    expect(res.status).toBe(404)
  })

  it('seeds dialogues, annotations, and settings, folded into one manifest update', async () => {
    const dialogue = {
      id: 'd1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      title: 't',
      sourceText: 'A: hi',
      currentAnnotationId: null,
    }
    const annotation = {
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
    }
    const settings = [
      {
        key: 'model',
        value: 'claude-opus-5',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]

    const res = await POST(
      request(
        { dialogues: [dialogue], annotations: [annotation], settings },
        'thai_ns=seed-2',
      ),
    )
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.counts).toEqual({ dialogues: 1, annotations: 1, settings: 1 })

    const records = createRecordsApi(createStore('memory'), 'ns/seed-2/v1/')
    expect(await records.getDialogue('d1')).toEqual(dialogue)
    expect(await records.getAnnotation('a1')).toEqual(annotation)
    expect(await records.getSettings()).toEqual(settings)
    const manifest = await records.getManifest()
    expect(Object.keys(manifest.entries).sort()).toEqual(
      ['annotation:a1', 'dialogue:d1', 'settings:all'].sort(),
    )
  })
})
