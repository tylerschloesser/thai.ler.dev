import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnnotateError } from '../../src/llm/annotateLine.js'
import type { LineProvider } from '../../src/llm/provider.js'
import type { AnnotationRecord, Dialogue } from '../../src/lib/records.js'
import { LEGACY_RUN } from '../../src/lib/records.js'
import { createRecordsApi } from './records.js'
import { createMemoryStore, resetMemoryStoreForTests } from './store/memory.js'
import type { BlobStore } from './store/index.js'
import {
  CANCEL_CHECK_INTERVAL_MS,
  CONCURRENCY,
  MAX_HOPS,
  runStep,
  systemClock,
  type RunnerContext,
} from './runner.js'

function dialogue(lineCount: number): Dialogue {
  const lines = Array.from(
    { length: lineCount },
    (_, i) => `Speaker: line ${i}`,
  )
  return {
    id: 'd1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    title: 'Test',
    sourceText: lines.join('\n'),
    currentAnnotationId: 'a1',
  }
}

function annotation(
  overrides: Partial<AnnotationRecord> = {},
): AnnotationRecord {
  const lineCount = overrides.lines?.length ?? 3
  return {
    id: 'a1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    dialogueId: 'd1',
    model: 'claude-opus-5',
    promptVersion: 2,
    schemaVersion: 1,
    lines: new Array(lineCount).fill(null),
    lineErrors: new Array(lineCount).fill(null),
    status: 'partial',
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    durationMs: 0,
    run: { ...LEGACY_RUN, state: 'queued', provider: 'fake', steps: 0 },
    ...overrides,
  }
}

/** A LineProvider whose per-line duration/onStart timing/failure is fully controllable via injected fake timers. */
function makeControllableProvider(opts: {
  durationMs: number
  onStartDelayMs?: number
  fail?: (lineIndex: number) => boolean
  events: string[]
}): LineProvider & { maxConcurrent: number } {
  let concurrent = 0
  let maxConcurrent = 0
  return {
    name: 'fake',
    get maxConcurrent() {
      return maxConcurrent
    },
    async annotate({ lineIndex, onStart }) {
      opts.events.push(`start:${lineIndex}`)
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      if (opts.onStartDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, opts.onStartDelayMs))
      }
      onStart?.()
      if (opts.onStartDelayMs) opts.events.push(`onStart:${lineIndex}`)
      const remaining = opts.durationMs - (opts.onStartDelayMs ?? 0)
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining))
      }
      concurrent -= 1
      opts.events.push(`done:${lineIndex}`)
      if (opts.fail?.(lineIndex)) {
        throw new AnnotateError('unknown', `line ${lineIndex} failed`)
      }
      return {
        line: {
          speaker: null,
          thai: `line ${lineIndex}`,
          translation: `line ${lineIndex}`,
          sentences: [],
          notes: [],
        },
        warnings: [],
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
      }
    },
  }
}

function countingStore(store: BlobStore): {
  store: BlobStore
  counts: { puts: number }
} {
  const counts = { puts: 0 }
  return {
    counts,
    store: {
      getJson: (path) => store.getJson(path),
      list: (prefix) => store.list(prefix),
      del: (urls) => store.del(urls),
      async putJson(path, value, opts) {
        counts.puts += 1
        return store.putJson(path, value, opts)
      },
    },
  }
}

async function seed(
  store: BlobStore,
  dlg: Dialogue,
  ann: AnnotationRecord,
): Promise<void> {
  const records = createRecordsApi(store, 'v1/')
  await records.putRecords(
    [
      { kind: 'dialogue', id: dlg.id, value: dlg },
      { kind: 'annotation', id: ann.id, value: ann },
    ],
    { manifest: true },
  )
}

function baseContext(
  store: BlobStore,
  overrides: Partial<RunnerContext> = {},
): RunnerContext {
  return {
    records: createRecordsApi(store, 'v1/'),
    stepBudgetMs: 250_000,
    origin: 'http://localhost:3000',
    testCookie: null,
    internalSecret: 'local-dev',
    fakeError: null,
    fakeDelayMs: null,
    clock: systemClock,
    getDeadlineMs: () => Number.POSITIVE_INFINITY,
    createProvider: () => {
      throw new Error('createProvider not stubbed for this test')
    },
    hop: async () => false,
    ...overrides,
  }
}

beforeEach(() => {
  resetMemoryStoreForTests()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runStep', () => {
  it('does nothing when the record is already done', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(1)
    const ann = annotation({
      lines: ['x' as never],
      run: { ...LEGACY_RUN, state: 'done' },
    })
    await seed(store, dlg, ann)
    const { store: counting, counts } = countingStore(store)
    await runStep(baseContext(counting), 'a1')
    expect(counts.puts).toBe(0)
  })

  it('does nothing when the record is cancelled', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(1)
    const ann = annotation({ run: { ...LEGACY_RUN, state: 'cancelled' } })
    await seed(store, dlg, ann)
    const { store: counting, counts } = countingStore(store)
    await runStep(baseContext(counting), 'a1')
    expect(counts.puts).toBe(0)
  })

  it('skips a record whose lease is still live (busy runner)', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(1)
    const future = new Date(Date.now() + 60_000).toISOString()
    const ann = annotation({
      run: { ...LEGACY_RUN, state: 'running', leaseUntil: future },
    })
    await seed(store, dlg, ann)
    const { store: counting, counts } = countingStore(store)
    await runStep(baseContext(counting), 'a1')
    expect(counts.puts).toBe(0)
  })

  it('records a step-level failure (lastError) when ANTHROPIC_API_KEY is missing, without touching lines', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(2)
    const ann = annotation({
      lines: [null, null],
      run: { ...LEGACY_RUN, state: 'queued', provider: 'anthropic' },
    })
    await seed(store, dlg, ann)

    const ctx = baseContext(store, {
      createProvider: () => {
        throw new Error('ANTHROPIC_API_KEY is not set')
      },
    })
    await runStep(ctx, 'a1')

    const after = await ctx.records.getAnnotation('a1')
    expect(after?.lines).toEqual([null, null])
    expect(after?.run.lastError).toMatch(/ANTHROPIC_API_KEY/)
    expect(after?.run.steps).toBe(0)
  })

  it('warm-up gate: the first pending line runs alone until onStart, then the rest fan out', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(3)
    const ann = annotation({ lines: [null, null, null] })
    await seed(store, dlg, ann)

    const events: string[] = []
    const provider = makeControllableProvider({
      durationMs: 1000,
      onStartDelayMs: 10,
      events,
    })
    const ctx = baseContext(store, { createProvider: () => provider })

    const stepPromise = runStep(ctx, 'a1')
    await vi.advanceTimersByTimeAsync(1500)
    await stepPromise

    // Line 0 starts alone; lines 1 and 2 only start once line 0 signals
    // onStart, and well before line 0 itself finishes.
    const start0 = events.indexOf('start:0')
    const onStart0 = events.indexOf('onStart:0')
    const start1 = events.indexOf('start:1')
    const start2 = events.indexOf('start:2')
    const done0 = events.indexOf('done:0')
    expect(start0).toBe(0)
    expect(onStart0).toBeGreaterThan(start0)
    expect(start1).toBeGreaterThan(onStart0)
    expect(start2).toBeGreaterThan(onStart0)
    expect(start1).toBeLessThan(done0)
    expect(start2).toBeLessThan(done0)
  })

  it('fans out up to CONCURRENCY (6) lines at once when a line has already succeeded', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(9)
    const ann = annotation({
      lines: [
        {
          speaker: null,
          thai: 'x',
          translation: 'x',
          sentences: [],
          notes: [],
        },
        ...new Array(8).fill(null),
      ],
      lineErrors: new Array(9).fill(null),
    })
    await seed(store, dlg, ann)

    const events: string[] = []
    const provider = makeControllableProvider({ durationMs: 1000, events })
    const ctx = baseContext(store, { createProvider: () => provider })

    const stepPromise = runStep(ctx, 'a1')
    await vi.advanceTimersByTimeAsync(2000)
    await stepPromise

    expect(provider.maxConcurrent).toBe(CONCURRENCY)
    const after = await ctx.records.getAnnotation('a1')
    expect(after?.lines.every((l) => l !== null)).toBe(true)
    expect(after?.status).toBe('complete')
  })

  it('reserve stop: does not start new lines once remaining budget dips below the reserve', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(9)
    const ann = annotation({
      lines: [
        {
          speaker: null,
          thai: 'x',
          translation: 'x',
          sentences: [],
          notes: [],
        },
        ...new Array(8).fill(null),
      ],
      lineErrors: new Array(9).fill(null),
    })
    await seed(store, dlg, ann)

    const events: string[] = []
    const provider = makeControllableProvider({ durationMs: 80, events })
    // budget = 100 (deadline is Infinity), lineReserveMs = floor(100/2) = 50.
    // After the first wave of 6 lines (80ms), remaining budget is 20 < 50.
    const ctx = baseContext(store, {
      stepBudgetMs: 100,
      createProvider: () => provider,
    })

    const stepPromise = runStep(ctx, 'a1')
    await vi.advanceTimersByTimeAsync(200)
    await stepPromise

    const after = await ctx.records.getAnnotation('a1')
    const succeeded = after!.lines.filter((l) => l !== null).length
    expect(succeeded).toBe(7) // 1 pre-seeded + 6 from the first wave
    expect(after!.lines.some((l) => l === null)).toBe(true)
    expect(after!.run.state).toBe('running') // stalled, not done
  })

  it('progress guarantee: always starts at least one line even with a blown deadline', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(5)
    const ann = annotation({
      lines: new Array(5).fill(null),
      lineErrors: new Array(5).fill(null),
    })
    await seed(store, dlg, ann)

    const events: string[] = []
    const provider = makeControllableProvider({ durationMs: 10, events })
    const ctx = baseContext(store, {
      // deadline already 15s in the past relative to the 20s safety margin
      getDeadlineMs: () => Date.now() + 5_000,
      createProvider: () => provider,
      hop: async () => false,
    })

    const stepPromise = runStep(ctx, 'a1')
    await vi.advanceTimersByTimeAsync(1000)
    await stepPromise

    const after = await ctx.records.getAnnotation('a1')
    const attempted = after!.lines.filter((l) => l !== null).length
    expect(attempted).toBe(1)
  })

  it('flush cadence: an exact put count for a 20-pending-line job', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(21)
    const ann = annotation({
      lines: [
        {
          speaker: null,
          thai: 'x',
          translation: 'x',
          sentences: [],
          notes: [],
        },
        ...new Array(20).fill(null),
      ],
      lineErrors: new Array(21).fill(null),
    })
    await seed(store, dlg, ann)

    const events: string[] = []
    // 6/6/6/2-line waves at 6500ms each: only the last wave (finishing at
    // 26000ms) crosses the 25000ms flush threshold, and only once (the
    // first of the 2 workers in that wave flushes; the second sees
    // lastFlushAt already refreshed).
    const provider = makeControllableProvider({ durationMs: 6_500, events })
    const { store: counting, counts } = countingStore(store)
    const ctx = baseContext(counting, { createProvider: () => provider })

    const stepPromise = runStep(ctx, 'a1')
    await vi.advanceTimersByTimeAsync(30_000)
    await stepPromise

    const after = await createRecordsApi(store, 'v1/').getAnnotation('a1')
    expect(after?.status).toBe('complete')
    // 1 initial lease-take + 1 mid-run periodic flush + 1 final record put
    // + 1 final manifest put.
    expect(counts.puts).toBe(4)
  })

  it('cancel mid-run: stops starting new lines, keeps already-finished ones, preserves "cancelled"', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(9)
    const ann = annotation({
      lines: [
        {
          speaker: null,
          thai: 'x',
          translation: 'x',
          sentences: [],
          notes: [],
        },
        ...new Array(8).fill(null),
      ],
      lineErrors: new Array(9).fill(null),
    })
    await seed(store, dlg, ann)

    const events: string[] = []
    const provider = makeControllableProvider({ durationMs: 6_000, events })
    const records = createRecordsApi(store, 'v1/')
    const ctx = baseContext(store, { createProvider: () => provider })

    const stepPromise = runStep(ctx, 'a1')
    // Let the first wave of 6 lines start (synchronously dispatched at t=0),
    // then cancel externally before they finish.
    await vi.advanceTimersByTimeAsync(0)
    const current = await records.getAnnotation('a1')
    await records.putRecords(
      [
        {
          kind: 'annotation',
          id: 'a1',
          value: { ...current!, run: { ...current!.run, state: 'cancelled' } },
        },
      ],
      { manifest: false },
    )

    await vi.advanceTimersByTimeAsync(CANCEL_CHECK_INTERVAL_MS + 6_000)
    await stepPromise

    const after = await records.getAnnotation('a1')
    expect(after?.run.state).toBe('cancelled')
    const succeeded = after!.lines.filter((l) => l !== null).length
    expect(succeeded).toBe(7) // 1 pre-seeded + the 6 already in flight
    expect(after!.lines.some((l) => l === null)).toBe(true)
    expect(after!.status).toBe('partial')
  })

  // 8 pending lines, 80ms each, budget=100 (reserve=50): wave 1 (6 lines)
  // finishes at t=80, leaving 20ms of budget - below the 50ms reserve - so
  // 2 lines are never started and the step ends with lines remaining.
  function eightPendingLinesAnnotation(hops: number): AnnotationRecord {
    return annotation({
      lines: [
        {
          speaker: null,
          thai: 'x',
          translation: 'x',
          sentences: [],
          notes: [],
        },
        ...new Array(8).fill(null),
      ],
      lineErrors: new Array(9).fill(null),
      run: { ...LEGACY_RUN, state: 'queued', hops },
    })
  }

  it('hop decision: hops when lines remain and hops < MAX_HOPS', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(9)
    await seed(store, dlg, eightPendingLinesAnnotation(0))

    const events: string[] = []
    const provider = makeControllableProvider({ durationMs: 80, events })
    let hopCalled = 0
    const ctx = baseContext(store, {
      stepBudgetMs: 100,
      createProvider: () => provider,
      hop: async () => {
        hopCalled += 1
        return true
      },
    })

    const stepPromise = runStep(ctx, 'a1')
    await vi.advanceTimersByTimeAsync(200)
    await stepPromise

    expect(hopCalled).toBe(1)
    const after = await createRecordsApi(store, 'v1/').getAnnotation('a1')
    expect(after?.run.state).toBe('running')
    expect(after?.lines.some((l) => l === null)).toBe(true)
  })

  it('refuses to hop when hops >= MAX_HOPS', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(9)
    await seed(store, dlg, eightPendingLinesAnnotation(MAX_HOPS))

    const events: string[] = []
    const provider = makeControllableProvider({ durationMs: 80, events })
    let hopCalled = 0
    const ctx = baseContext(store, {
      stepBudgetMs: 100,
      createProvider: () => provider,
      hop: async () => {
        hopCalled += 1
        return true
      },
    })

    const stepPromise = runStep(ctx, 'a1')
    await vi.advanceTimersByTimeAsync(200)
    await stepPromise

    expect(hopCalled).toBe(0)
  })

  it('stalled outcome: a failed hop still leaves the record visibly stalled, not crashed', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(9)
    await seed(store, dlg, eightPendingLinesAnnotation(0))

    const events: string[] = []
    const provider = makeControllableProvider({ durationMs: 80, events })
    const ctx = baseContext(store, {
      stepBudgetMs: 100,
      createProvider: () => provider,
      hop: async () => false, // hop failed
    })

    const stepPromise = runStep(ctx, 'a1')
    await vi.advanceTimersByTimeAsync(200)
    await stepPromise

    const after = await createRecordsApi(store, 'v1/').getAnnotation('a1')
    expect(after?.run.state).toBe('running')
    expect(after?.lines.some((l) => l === null)).toBe(true)
  })

  it('accumulates usage and durationMs across lines', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(2)
    const ann = annotation({ lines: [null, null], lineErrors: [null, null] })
    await seed(store, dlg, ann)

    const events: string[] = []
    const provider = makeControllableProvider({ durationMs: 100, events })
    const ctx = baseContext(store, { createProvider: () => provider })

    const stepPromise = runStep(ctx, 'a1')
    await vi.advanceTimersByTimeAsync(200)
    await stepPromise

    const after = await createRecordsApi(store, 'v1/').getAnnotation('a1')
    expect(after?.usage.inputTokens).toBe(2)
    expect(after?.usage.outputTokens).toBe(2)
    expect(after?.durationMs).toBeGreaterThan(0)
  })

  it('a line error is recorded in lineErrors, not run.lastError, and triggers a flush', async () => {
    const store = createMemoryStore()
    const dlg = dialogue(1)
    const ann = annotation({ lines: [null], lineErrors: [null] })
    await seed(store, dlg, ann)

    const events: string[] = []
    const provider = makeControllableProvider({
      durationMs: 50,
      fail: () => true,
      events,
    })
    const { store: counting, counts } = countingStore(store)
    const ctx = baseContext(counting, { createProvider: () => provider })

    const stepPromise = runStep(ctx, 'a1')
    await vi.advanceTimersByTimeAsync(100)
    await stepPromise

    const after = await createRecordsApi(store, 'v1/').getAnnotation('a1')
    expect(after?.lines[0]).toBeNull()
    expect(after?.lineErrors[0]).toMatch(/line 0 failed/)
    expect(after?.run.lastError).toBeNull()
    // initial lease-take + error-triggered flush + final stall write (the
    // one line never succeeded, so this ends "still running", not "done" -
    // no manifest put).
    expect(counts.puts).toBe(3)
  })
})
