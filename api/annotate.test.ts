import { beforeEach, describe, expect, it } from 'vitest'
import { createRecordsApi } from './_lib/records.js'
import { resetMemoryStoreForTests } from './_lib/store/memory.js'
import { POST } from './annotate.js'
import { jsonBody } from './_lib/jsonBody.js'

function request(body: unknown, cookie?: string): Request {
  return new Request('http://localhost:3000/api/annotate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

function dialogueBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    title: 'Test dialogue',
    sourceText: 'A: hi\nB: hello',
    currentAnnotationId: null,
    ...overrides,
  }
}

beforeEach(() => {
  resetMemoryStoreForTests()
  process.env['BLOB_BACKEND'] = 'memory'
  process.env['ALLOW_TEST_MODE'] = '1'
  process.env['MODEL_PROVIDER'] = 'fake'
})

describe('POST /api/annotate', () => {
  it('creates a queued annotation record and returns 202', async () => {
    const res = await POST(
      request(
        { dialogue: dialogueBody(), model: 'claude-opus-5' },
        'thai_ns=annotate-1',
      ),
    )
    expect(res.status).toBe(202)
    const body = await jsonBody(res)
    expect(body.dialogue.currentAnnotationId).toBe(body.annotation.id)
    expect(body.annotation.run.state).toMatch(/queued|running|done/)
    expect(body.annotation.lines).toHaveLength(2)
    expect(body.annotation.model).toBe('claude-opus-5')
  })

  it('rejects an unknown model', async () => {
    const res = await POST(
      request(
        { dialogue: dialogueBody(), model: 'gpt-4' },
        'thai_ns=annotate-2',
      ),
    )
    expect(res.status).toBe(400)
  })

  it('sets the annotation run.provider from thai_model in test mode', async () => {
    const res = await POST(
      request(
        { dialogue: dialogueBody({ id: 'd2' }), model: 'claude-opus-5' },
        'thai_ns=annotate-3; thai_model=fake-slow; thai_step_budget_ms=1',
      ),
    )
    const body = await jsonBody(res)
    expect(body.annotation.run.provider).toBe('fake-slow')
  })

  it('writes the dialogue and annotation, folded into one manifest update', async () => {
    const res = await POST(
      request(
        { dialogue: dialogueBody({ id: 'd3' }), model: 'claude-opus-5' },
        'thai_ns=annotate-4',
      ),
    )
    const body = await jsonBody(res)

    // Build a records API pointed at the same namespace the handler used.
    const { createContext } = await import('./_lib/context.js')
    const ctx = createContext(
      new Request('http://localhost:3000/x', {
        headers: { cookie: 'thai_ns=annotate-4' },
      }),
    )
    const records = createRecordsApi(ctx.store, ctx.prefix)
    const manifest = await records.getManifest()
    expect(manifest.entries['dialogue:d3']).toBeDefined()
    expect(manifest.entries[`annotation:${body.annotation.id}`]).toBeDefined()
  })
})
