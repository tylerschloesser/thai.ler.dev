import { getDeadline } from '@vercel/functions'
import type { AnnotationRecord, RunProvider } from '../../src/lib/records.js'
import { nowIso } from '../../src/lib/time.js'
import type { LineProvider } from '../../src/llm/provider.js'
import { splitDialogue } from '../../src/llm/split.js'
import type { RequestContext } from './context.js'
import type { HopDeps } from './hop.js'
import { hop as realHop } from './hop.js'
import type { CreateProviderOptions } from './providers/index.js'
import { createProvider as realCreateProvider } from './providers/index.js'
import type { RecordsApi } from './records.js'
import { createRecordsApi } from './records.js'

/**
 * `runStep()`: one deadline-aware pass over an `AnnotationRecord`'s pending
 * lines, invoked inside `waitUntil` by `annotate`, `resume`, and `step`
 * (PLAN.MD §4.2, §10). Lease-checked so two runners never race the same
 * record; flushes on a cadence (not per line); hops to itself at most once
 * per step, up to `MAX_HOPS` per lineage, when lines remain at the end.
 */

export const CONCURRENCY = 6
export const FLUSH_EVERY_MS = 25_000
export const MAX_HOPS = 3
export const MAX_LINE_RESERVE_MS = 70_000
export const DEADLINE_SAFETY_MARGIN_MS = 20_000
export const LEASE_EXTRA_MS = 30_000
/** How live a lease must be (beyond "now") before a second runner backs off. */
export const LEASE_GRACE_MS = 5_000
/** How often, at minimum, the runner re-reads the stored record's `run.state` while a line is in flight. */
export const CANCEL_CHECK_INTERVAL_MS = 5_000

export interface RunnerClock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const systemClock: RunnerClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export interface RunnerContext {
  records: RecordsApi
  /** Caps the step's budget; the deadline (when available) caps it further. */
  stepBudgetMs: number
  origin: string
  testCookie: string | null
  internalSecret: string | undefined
  fakeError: string | null
  fakeDelayMs: number | null
  clock: RunnerClock
  /** Absolute epoch ms the invocation will be killed at, or `Infinity` off Vercel / in tests with no deadline. */
  getDeadlineMs: () => number
  createProvider: (
    name: RunProvider,
    opts: CreateProviderOptions,
  ) => LineProvider
  hop: (deps: HopDeps, annotationId: string) => Promise<boolean>
}

/** Builds a `RunnerContext` with real dependencies from a request's `RequestContext` (PLAN.MD §10). */
export function buildRunnerContext(ctx: RequestContext): RunnerContext {
  return {
    records: createRecordsApi(ctx.store, ctx.prefix),
    stepBudgetMs: ctx.stepBudgetMs,
    origin: ctx.origin,
    testCookie: ctx.testCookie,
    internalSecret: ctx.env.INTERNAL_SECRET,
    fakeError: ctx.fakeError,
    fakeDelayMs: ctx.fakeDelayMs,
    clock: systemClock,
    // `getDeadline()` (Corrected during M0): `(): Date | undefined`, live on
    // Vercel, always undefined locally.
    getDeadlineMs: () => getDeadline()?.getTime() ?? Number.POSITIVE_INFINITY,
    createProvider: realCreateProvider,
    hop: realHop,
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function stepLevelFailure(
  ctx: RunnerContext,
  rec: AnnotationRecord,
  message: string,
): Promise<void> {
  rec.run = { ...rec.run, lastError: message, leaseUntil: null }
  rec.updatedAt = nowIso()
  await ctx.records.putRecords(
    [{ kind: 'annotation', id: rec.id, value: rec }],
    { manifest: false },
  )
}

export async function runStep(
  ctx: RunnerContext,
  annotationId: string,
): Promise<void> {
  const loaded = await ctx.records.getAnnotation(annotationId)
  if (!loaded) return
  if (loaded.run.state === 'done' || loaded.run.state === 'cancelled') return
  // A plain `AnnotationRecord` (not `| null`) binding so the nested
  // closures below (captured by `function` declarations, which TS does not
  // narrow across) don't need a null check on every access.
  const rec: AnnotationRecord = loaded

  const startedAt = ctx.clock.now()
  if (
    rec.run.leaseUntil !== null &&
    Date.parse(rec.run.leaseUntil) > startedAt + LEASE_GRACE_MS
  ) {
    return // another runner holds a live lease
  }

  const dialogue = await ctx.records.getDialogue(rec.dialogueId)
  if (!dialogue) {
    await stepLevelFailure(ctx, rec, `dialogue "${rec.dialogueId}" not found`)
    return
  }
  const splitLines = splitDialogue(dialogue.sourceText)

  let provider: LineProvider
  try {
    provider = ctx.createProvider(rec.run.provider, {
      fakeError: ctx.fakeError,
      fakeDelayMs: ctx.fakeDelayMs,
    })
  } catch (err) {
    await stepLevelFailure(ctx, rec, messageOf(err))
    return
  }

  const deadlineMs = ctx.getDeadlineMs()
  const budget = Math.min(
    deadlineMs - startedAt - DEADLINE_SAFETY_MARGIN_MS,
    ctx.stepBudgetMs,
  )
  const lineReserveMs = Math.min(MAX_LINE_RESERVE_MS, Math.floor(budget / 2))
  const stepDeadline = startedAt + budget

  rec.run = {
    ...rec.run,
    state: 'running',
    steps: rec.run.steps + 1,
    leaseUntil: new Date(startedAt + budget + LEASE_EXTRA_MS).toISOString(),
    lastError: null,
  }
  // Clear stale errors only for lines still pending; a line that already
  // succeeded never had a live error to begin with.
  rec.lineErrors = rec.lineErrors.map((err, i) =>
    rec.lines[i] === null ? null : err,
  )

  let lastFlushAt = startedAt
  let lastCancelCheckAt = startedAt

  async function persistRecordOnly(): Promise<void> {
    lastFlushAt = ctx.clock.now()
    rec.updatedAt = nowIso()
    await ctx.records.putRecords(
      [{ kind: 'annotation', id: rec.id, value: rec }],
      { manifest: false },
    )
  }

  /** Re-reads the stored record and adopts 'cancelled' if that's what it now says (cancel may land on another instance). */
  async function refreshCancelledState(): Promise<boolean> {
    lastCancelCheckAt = ctx.clock.now()
    const stored = await ctx.records.getAnnotation(annotationId)
    if (stored && stored.run.state === 'cancelled') {
      rec.run = { ...rec.run, state: 'cancelled' }
      return true
    }
    return false
  }

  async function flush(): Promise<void> {
    await refreshCancelledState()
    await persistRecordOnly()
  }

  async function runLine(index: number, onStart?: () => void): Promise<void> {
    try {
      const result = await provider.annotate({
        model: rec.model,
        lines: splitLines,
        lineIndex: index,
        onStart,
      })
      rec.lines[index] = result.line
      rec.lineErrors[index] = null
      rec.usage = {
        inputTokens: rec.usage.inputTokens + result.usage.inputTokens,
        outputTokens: rec.usage.outputTokens + result.usage.outputTokens,
        cacheReadTokens:
          rec.usage.cacheReadTokens + result.usage.cacheReadTokens,
      }
    } catch (err) {
      rec.lineErrors[index] = messageOf(err)
      await flush()
    }
  }

  async function pump(initialQueue: number[]): Promise<void> {
    const queue = [...initialQueue]
    let startedAnyLine = false
    const noneSucceededYet = !rec.lines.some((line) => line !== null)

    let warmupPromise: Promise<void> | null = null
    if (noneSucceededYet && queue.length > 1) {
      const firstIndex = queue.shift() as number
      startedAnyLine = true
      let signalStart: () => void = () => {}
      const started = new Promise<void>((resolve) => {
        signalStart = resolve
      })
      warmupPromise = runLine(firstIndex, signalStart).finally(signalStart)
      await started
    }

    async function worker(): Promise<void> {
      for (;;) {
        if (rec.run.state === 'cancelled') return
        if (ctx.clock.now() - lastCancelCheckAt >= CANCEL_CHECK_INTERVAL_MS) {
          if (await refreshCancelledState()) return
        }
        if (queue.length === 0) return
        if (startedAnyLine) {
          const remainingBudget = stepDeadline - ctx.clock.now()
          if (remainingBudget < lineReserveMs) return
        }
        const index = queue.shift()
        if (index === undefined) return
        startedAnyLine = true
        await runLine(index)
        if (ctx.clock.now() - lastFlushAt >= FLUSH_EVERY_MS) await flush()
      }
    }

    const workerCount =
      queue.length > 0 ? Math.min(CONCURRENCY, queue.length) : 0
    const workers = Array.from({ length: workerCount }, () => worker())
    await Promise.all([...(warmupPromise ? [warmupPromise] : []), ...workers])
  }

  await persistRecordOnly() // initial lease-take write

  const pendingAtStart = rec.lines.flatMap((line, i) =>
    line === null ? [i] : [],
  )
  if (pendingAtStart.length > 0) {
    await pump(pendingAtStart)
  }

  // Before the final write: re-check cancellation regardless of whether the
  // loop above already noticed it.
  await refreshCancelledState()
  const isCancelled = rec.run.state === 'cancelled'
  const stillPending = rec.lines.some((line) => line === null)

  rec.durationMs += ctx.clock.now() - startedAt
  rec.updatedAt = nowIso()

  if (stillPending && !isCancelled) {
    rec.run = {
      ...rec.run,
      state: 'running',
      leaseUntil: new Date(ctx.clock.now()).toISOString(), // visibly stalled unless the hop takes over
    }
    await ctx.records.putRecords(
      [{ kind: 'annotation', id: rec.id, value: rec }],
      { manifest: false },
    )
    if (rec.run.hops < MAX_HOPS) {
      await ctx.hop(
        {
          origin: ctx.origin,
          internalSecret: ctx.internalSecret,
          testCookie: ctx.testCookie,
        },
        annotationId,
      )
    }
    return
  }

  rec.run = {
    ...rec.run,
    state: isCancelled ? 'cancelled' : 'done',
    leaseUntil: null,
  }
  rec.status = rec.lines.every((line) => line !== null) ? 'complete' : 'partial'
  await ctx.records.putRecords(
    [{ kind: 'annotation', id: rec.id, value: rec }],
    { manifest: true },
  )
}
