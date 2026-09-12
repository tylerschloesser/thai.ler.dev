import { beforeEach, describe, expect, it } from 'vitest'
import { createRecordsApi } from '../_lib/records.js'
import { createStore } from '../_lib/store/index.js'
import { resetMemoryStoreForTests } from '../_lib/store/memory.js'
import { DELETE } from './namespace.js'
import { jsonBody } from '../_lib/jsonBody.js'

beforeEach(() => {
  resetMemoryStoreForTests()
  process.env['BLOB_BACKEND'] = 'memory'
})

function request(qs: string, allowTestMode = true): Request {
  if (allowTestMode) process.env['ALLOW_TEST_MODE'] = '1'
  else delete process.env['ALLOW_TEST_MODE']
  return new Request(`http://localhost:3000/api/test/namespace?${qs}`, {
    method: 'DELETE',
  })
}

describe('DELETE /api/test/namespace', () => {
  it('404s when test mode is off', async () => {
    const res = await DELETE(request('ns=ns-1', false))
    expect(res.status).toBe(404)
  })

  it('400s for a missing or invalid ns', async () => {
    expect((await DELETE(request(''))).status).toBe(400)
    expect((await DELETE(request('ns=Not_Valid!'))).status).toBe(400)
  })

  it('deletes only blobs under ns/<ns>/, never the default v1/ prefix', async () => {
    const store = createStore('memory')
    const target = createRecordsApi(store, 'ns/victim/v1/')
    const other = createRecordsApi(store, 'ns/bystander/v1/')
    const shared = createRecordsApi(store, 'v1/')

    const dlg = (id: string) => ({
      id,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      title: 't',
      sourceText: 'A: hi',
      currentAnnotationId: null,
    })

    await target.putRecords(
      [{ kind: 'dialogue', id: 'd1', value: dlg('d1') }],
      {
        manifest: true,
      },
    )
    await other.putRecords([{ kind: 'dialogue', id: 'd2', value: dlg('d2') }], {
      manifest: true,
    })
    await shared.putRecords(
      [{ kind: 'dialogue', id: 'd3', value: dlg('d3') }],
      {
        manifest: true,
      },
    )

    const res = await DELETE(request('ns=victim'))
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    expect(body.deleted).toBeGreaterThan(0)

    expect(await target.getDialogue('d1')).toBeNull()
    expect(await other.getDialogue('d2')).not.toBeNull()
    expect(await shared.getDialogue('d3')).not.toBeNull()
  })
})
