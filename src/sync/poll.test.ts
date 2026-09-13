import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AnnotationRecord } from '../lib/records'
import { db } from '../db/db'
import {
  isLeaseStalled,
  pollNow,
  stopAllWatchers,
  watchAnnotation,
} from './poll'
import type { PollDeps } from './poll'
import type { ResumeOutcome, SyncApi } from './api'

beforeEach(async () => {
  await db.annotations.clear()
})

afterEach(() => {
  stopAllWatchers()
})

function stubApi(overrides: Partial<SyncApi>): SyncApi {
  return {
    getManifest: async () => {
      throw new Error('not stubbed')
    },
    getRecord: async () => {
      throw new Error('not stubbed')
    },
    putRecord: async () => {
      throw new Error('not stubbed')
    },
    getAnnotation: async () => {
      throw new Error('not stubbed')
    },
    annotate: async () => {
      throw new Error('not stubbed')
    },
    resumeAnnotation: async () => {
      throw new Error('not stubbed')
    },
    cancelAnnotation: async () => {
      throw new Error('not stubbed')
    },
    rebuildManifest: async () => {
      throw new Error('not stubbed')
    },
    ...overrides,
  }
}

function makeRecord(
  overrides: Partial<AnnotationRecord> = {},
): AnnotationRecord {
  return {
    id: 'a1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    dialogueId: 'd1',
    model: 'claude-opus-5',
    promptVersion: 1,
    schemaVersion: 1,
    lines: [null],
    lineErrors: [null],
    status: 'partial',
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    durationMs: 0,
    run: {
      state: 'running',
      provider: 'fake-slow',
      leaseUntil: null,
      hops: 0,
      steps: 1,
      lastError: null,
    },
    ...overrides,
  }
}

// Never let the real setInterval drive these tests — everything is driven
// by explicit `pollNow()` calls.
const NEVER_MS = 1_000_000

describe('isLeaseStalled', () => {
  const now = 1_000_000

  it('a live (future) leaseUntil is not stalled', () => {
    const leaseUntil = new Date(now + 5_000).toISOString()
    expect(
      isLeaseStalled({ leaseUntil }, '2020-01-01T00:00:00.000Z', now),
    ).toBe(false)
  })

  it('a leaseUntil expired past the grace period is stalled', () => {
    const leaseUntil = new Date(now - 20_000).toISOString()
    expect(
      isLeaseStalled({ leaseUntil }, '2020-01-01T00:00:00.000Z', now),
    ).toBe(true)
  })

  it('a null leaseUntil falls back to updatedAt: live within 15s, stalled after', () => {
    const fresh = new Date(now - 1_000).toISOString()
    const stale = new Date(now - 20_000).toISOString()
    expect(isLeaseStalled({ leaseUntil: null }, fresh, now)).toBe(false)
    expect(isLeaseStalled({ leaseUntil: null }, stale, now)).toBe(true)
  })
})

describe('watchAnnotation / pollNow', () => {
  it('merges each polled record and stops once the run reaches done', async () => {
    let getCount = 0
    const api = stubApi({
      getAnnotation: async () => {
        getCount += 1
        return getCount === 1
          ? makeRecord({ run: { ...makeRecord().run, state: 'running' } })
          : makeRecord({
              updatedAt: '2026-01-02T00:00:00.000Z',
              status: 'complete',
              lines: [{} as never],
              run: { ...makeRecord().run, state: 'done' },
            })
      },
    })

    watchAnnotation('a1', { api, intervalMs: NEVER_MS })
    await pollNow()
    expect(getCount).toBe(1)
    expect((await db.annotations.get('a1'))?.run.state).toBe('running')

    await pollNow()
    expect(getCount).toBe(2)
    expect((await db.annotations.get('a1'))?.run.state).toBe('done')

    // Stopped itself on 'done' — a further pollNow() must not fetch again.
    await pollNow()
    expect(getCount).toBe(2)
  })

  it('resumes a stalled job at most once per minute', async () => {
    let now = 1_000_000
    const staleLeaseUntil = new Date(now - 20_000).toISOString() // > 15s stale

    let resumeCalls = 0
    const api = stubApi({
      getAnnotation: async () =>
        makeRecord({
          run: {
            state: 'running',
            provider: 'fake-slow',
            leaseUntil: staleLeaseUntil,
            hops: 0,
            steps: 1,
            lastError: null,
          },
        }),
      resumeAnnotation: async (): Promise<ResumeOutcome> => {
        resumeCalls += 1
        return {
          status: 'started',
          record: makeRecord({
            run: {
              state: 'running',
              provider: 'fake-slow',
              leaseUntil: new Date(now).toISOString(),
              hops: 0,
              steps: 2,
              lastError: null,
            },
          }),
        }
      },
    })
    const deps: PollDeps = { api, intervalMs: NEVER_MS, now: () => now }

    watchAnnotation('a1', deps)
    await pollNow()
    expect(resumeCalls).toBe(1)

    // Immediately again: still within the 60s cooldown.
    await pollNow()
    expect(resumeCalls).toBe(1)

    // 61s later: cooldown has passed.
    now += 61_000
    await pollNow()
    expect(resumeCalls).toBe(2)
  })

  it('does not attempt to resume while the lease is still fresh', async () => {
    const now = 1_000_000
    let resumeCalls = 0
    const api = stubApi({
      getAnnotation: async () =>
        makeRecord({
          run: {
            state: 'running',
            provider: 'fake-slow',
            leaseUntil: new Date(now - 1_000).toISOString(), // only 1s stale
            hops: 0,
            steps: 1,
            lastError: null,
          },
        }),
      resumeAnnotation: async (): Promise<ResumeOutcome> => {
        resumeCalls += 1
        return { status: 'started', record: makeRecord() }
      },
    })

    watchAnnotation('a1', { api, intervalMs: NEVER_MS, now: () => now })
    await pollNow()
    expect(resumeCalls).toBe(0)
  })

  it('pollNow ticks every active watcher', async () => {
    const seen: string[] = []
    const api = stubApi({
      getAnnotation: async () => {
        seen.push('called')
        return makeRecord({ run: { ...makeRecord().run, state: 'done' } })
      },
    })

    watchAnnotation('a1', { api, intervalMs: NEVER_MS })
    watchAnnotation('a2', { api, intervalMs: NEVER_MS })
    await pollNow()
    expect(seen).toHaveLength(2)
  })

  it('resumes a queued job whose runner never took a lease once its updatedAt is stale (null leaseUntil)', async () => {
    const now = 1_000_000
    const staleUpdatedAt = new Date(now - 20_000).toISOString() // > 15s stale

    let resumeCalls = 0
    const api = stubApi({
      getAnnotation: async () =>
        makeRecord({
          updatedAt: staleUpdatedAt,
          run: {
            state: 'queued',
            provider: 'fake-slow',
            leaseUntil: null,
            hops: 0,
            steps: 0,
            lastError: null,
          },
        }),
      resumeAnnotation: async (): Promise<ResumeOutcome> => {
        resumeCalls += 1
        return { status: 'started', record: makeRecord() }
      },
    })
    const deps: PollDeps = { api, intervalMs: NEVER_MS, now: () => now }

    watchAnnotation('a1', deps)
    await pollNow()
    expect(resumeCalls).toBe(1)
  })

  it('does not resume a queued job with a null leaseUntil while its updatedAt is still fresh', async () => {
    const now = 1_000_000
    const freshUpdatedAt = new Date(now - 1_000).toISOString() // only 1s old

    let resumeCalls = 0
    const api = stubApi({
      getAnnotation: async () =>
        makeRecord({
          updatedAt: freshUpdatedAt,
          run: {
            state: 'queued',
            provider: 'fake-slow',
            leaseUntil: null,
            hops: 0,
            steps: 0,
            lastError: null,
          },
        }),
      resumeAnnotation: async (): Promise<ResumeOutcome> => {
        resumeCalls += 1
        return { status: 'started', record: makeRecord() }
      },
    })

    watchAnnotation('a1', { api, intervalMs: NEVER_MS, now: () => now })
    await pollNow()
    expect(resumeCalls).toBe(0)
  })

  it('re-watching the same id replaces the previous watcher instead of running both', async () => {
    let firstCalls = 0
    let secondCalls = 0
    const firstApi = stubApi({
      getAnnotation: async () => {
        firstCalls += 1
        return makeRecord()
      },
    })
    const secondApi = stubApi({
      getAnnotation: async () => {
        secondCalls += 1
        return makeRecord()
      },
    })

    watchAnnotation('a1', { api: firstApi, intervalMs: NEVER_MS })
    watchAnnotation('a1', { api: secondApi, intervalMs: NEVER_MS })
    await pollNow()
    expect(firstCalls).toBe(0)
    expect(secondCalls).toBe(1)
  })
})
