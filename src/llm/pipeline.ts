import type Anthropic from '@anthropic-ai/sdk'
import { AnnotateError, annotateLine } from './annotateLine'
import { PROMPT_VERSION } from './prompt'
import { SCHEMA_VERSION, type LineAnnotation } from './schema'
import { splitDialogue, type SplitLine } from './split'

const DEFAULT_CONCURRENCY = 4

export interface AnnotationUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export type AnnotationStatus = 'partial' | 'complete'

/**
 * Persistence functions the pipeline needs, injected by the caller so this
 * module stays testable without React and without `src/db` (PLAN.MD §4.2 /
 * §5 M3). In the app these are thin wrappers around `src/db/repo.ts`; in
 * tests (and `scripts/gen-fixture.ts`) they can be in-memory.
 */
export interface PipelineRepo {
  createAnnotation(input: {
    dialogueId: string
    model: string
    promptVersion: number
    schemaVersion: number
    lineCount: number
  }): Promise<{ annotationId: string }>
  upsertLine(input: {
    annotationId: string
    lineIndex: number
    line: LineAnnotation | null
    error: string | null
    warnings: string[]
  }): Promise<void>
  finalize(input: {
    annotationId: string
    status: AnnotationStatus
    usage: AnnotationUsage
    durationMs: number
  }): Promise<void>
}

export interface LineEvent {
  lineIndex: number
  line: LineAnnotation | null
  error: string | null
  warnings: string[]
}

export interface PipelineOptions {
  client: Anthropic
  model: string
  signal?: AbortSignal
  /** Defaults to 4, per PLAN.MD §4.2. */
  concurrency?: number
  onLine?: (event: LineEvent) => void
  repo: PipelineRepo
}

export interface PipelineResult {
  annotationId: string
  status: AnnotationStatus
  usage: AnnotationUsage
  durationMs: number
  lines: Array<LineAnnotation | null>
  lineErrors: Array<string | null>
}

/** Runs `worker` over `items` with at most `limit` concurrent in flight. */
async function runConcurrent<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  async function pullNext(): Promise<void> {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      const item = items[index] as T
      await worker(item)
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => pullNext()))
}

interface RunLinesInput {
  annotationId: string
  splitLines: SplitLine[]
  indexesToRun: number[]
  lines: Array<LineAnnotation | null>
  lineErrors: Array<string | null>
}

function errorMessage(err: unknown): string {
  if (err instanceof AnnotateError) return err.message
  if (err instanceof Error) return err.message
  return 'Unknown error'
}

async function runLines(
  input: RunLinesInput,
  opts: PipelineOptions,
): Promise<AnnotationUsage> {
  const usage: AnnotationUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
  }
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY

  await runConcurrent(input.indexesToRun, concurrency, async (lineIndex) => {
    if (opts.signal?.aborted) return

    let line: LineAnnotation | null = null
    let error: string | null = null
    let warnings: string[] = []

    try {
      const result = await annotateLine(opts.client, {
        model: opts.model,
        lines: input.splitLines,
        lineIndex,
        signal: opts.signal,
      })
      line = result.line
      warnings = result.warnings
      usage.inputTokens += result.usage.inputTokens
      usage.outputTokens += result.usage.outputTokens
      usage.cacheReadTokens += result.usage.cacheReadTokens
    } catch (err) {
      error = errorMessage(err)
    }

    input.lines[lineIndex] = line
    input.lineErrors[lineIndex] = error

    await opts.repo.upsertLine({
      annotationId: input.annotationId,
      lineIndex,
      line,
      error,
      warnings,
    })
    opts.onLine?.({ lineIndex, line, error, warnings })
  })

  return usage
}

function computeStatus(lines: Array<LineAnnotation | null>): AnnotationStatus {
  return lines.every((line) => line !== null) ? 'complete' : 'partial'
}

/**
 * Runs the full annotation pipeline for a freshly-submitted dialogue:
 * creates the `AnnotationRecord` (`repo.createAnnotation`), then annotates
 * every line with concurrency-limited, per-line streamed calls - persisting
 * each line as it lands via `repo.upsertLine` - and finalizes with the
 * accumulated usage/duration. `status` is `'complete'` only when every line
 * annotated successfully.
 */
export async function annotateDialogue(
  dialogue: { id: string; sourceText: string },
  opts: PipelineOptions,
): Promise<PipelineResult> {
  const startedAt = Date.now()
  const splitLines = splitDialogue(dialogue.sourceText)
  const lines: Array<LineAnnotation | null> = new Array(splitLines.length).fill(
    null,
  )
  const lineErrors: Array<string | null> = new Array(splitLines.length).fill(
    null,
  )

  const { annotationId } = await opts.repo.createAnnotation({
    dialogueId: dialogue.id,
    model: opts.model,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    lineCount: splitLines.length,
  })

  const indexesToRun = splitLines.map((_, index) => index)
  const usage = await runLines(
    { annotationId, splitLines, indexesToRun, lines, lineErrors },
    opts,
  )

  const status = computeStatus(lines)
  const durationMs = Date.now() - startedAt
  await opts.repo.finalize({ annotationId, status, usage, durationMs })

  return { annotationId, status, usage, durationMs, lines, lineErrors }
}

export interface ResumeAnnotationInput {
  annotationId: string
  sourceText: string
  /** The existing record's lines, index-aligned with split(sourceText); `null` entries are re-run. */
  lines: Array<LineAnnotation | null>
}

/**
 * Re-runs only the `null` lines of an existing, partial `AnnotationRecord`
 * (e.g. after a cancel, or lines that failed), persisting into the same
 * `annotationId`.
 */
export async function resumeAnnotation(
  input: ResumeAnnotationInput,
  opts: PipelineOptions,
): Promise<PipelineResult> {
  const startedAt = Date.now()
  const splitLines = splitDialogue(input.sourceText)
  const lines = splitLines.map((_, index) => input.lines[index] ?? null)
  const lineErrors: Array<string | null> = splitLines.map(() => null)

  const indexesToRun = lines
    .map((line, index) => (line === null ? index : -1))
    .filter((index) => index !== -1)

  const usage = await runLines(
    {
      annotationId: input.annotationId,
      splitLines,
      indexesToRun,
      lines,
      lineErrors,
    },
    opts,
  )

  const status = computeStatus(lines)
  const durationMs = Date.now() - startedAt
  await opts.repo.finalize({
    annotationId: input.annotationId,
    status,
    usage,
    durationMs,
  })

  return {
    annotationId: input.annotationId,
    status,
    usage,
    durationMs,
    lines,
    lineErrors,
  }
}
