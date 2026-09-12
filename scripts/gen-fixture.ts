/**
 * One-off (re-run only when the prompt/schema changes) generator: runs the
 * real annotation runner (`api/_lib/runner.ts`, memory store, the
 * `anthropic` provider) over `src/fixtures/sample.dialogue.txt` with a real
 * Anthropic API key and writes `src/fixtures/sample.annotation.json`. Node
 * only - the Node client never sets `dangerouslyAllowBrowser` (that flag
 * was for the deleted P0 in-browser client). Run with `pnpm gen:fixture`.
 *
 * The API key comes from `process.env.ANTHROPIC_API_KEY` and is never
 * logged, written to a file, or otherwise echoed. M1 note: PROMPT_VERSION
 * and the schema are unchanged, so this script is not run as part of M1 -
 * it's kept in sync with the new runner/provider/store APIs so it's ready
 * whenever the prompt or schema next changes.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRecordsApi } from '../api/_lib/records.js'
import type { RunnerContext } from '../api/_lib/runner.js'
import { runStep, systemClock } from '../api/_lib/runner.js'
import { createProvider } from '../api/_lib/providers/index.js'
import { createStore } from '../api/_lib/store/index.js'
import { newId } from '../src/lib/ids.js'
import { nowIso } from '../src/lib/time.js'
import { PROMPT_VERSION } from '../src/llm/prompt.js'
import { SCHEMA_VERSION, type LineAnnotation } from '../src/llm/schema.js'
import { splitDialogue } from '../src/llm/split.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const DIALOGUE_PATH = path.join(
  here,
  '..',
  'src',
  'fixtures',
  'sample.dialogue.txt',
)
const OUTPUT_PATH = path.join(
  here,
  '..',
  'src',
  'fixtures',
  'sample.annotation.json',
)
const MODEL = 'claude-opus-5'

function requireApiKey(): string {
  const key = process.env['ANTHROPIC_API_KEY']
  if (!key) {
    console.error(
      'ANTHROPIC_API_KEY is not set. Export a real key before running `pnpm gen:fixture`.',
    )
    process.exit(1)
  }
  return key
}

async function main(): Promise<void> {
  requireApiKey() // validated eagerly for a clear error before doing any work

  const sourceText = readFileSync(DIALOGUE_PATH, 'utf8')
  const splitLines = splitDialogue(sourceText)
  console.log(`Annotating ${splitLines.length} line(s) with ${MODEL}...`)

  const store = createStore('memory')
  const prefix = 'v1/'
  const records = createRecordsApi(store, prefix)

  const now = nowIso()
  const dialogueId = newId()
  const annotationId = newId()

  await records.putRecords(
    [
      {
        kind: 'dialogue',
        id: dialogueId,
        value: {
          id: dialogueId,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          title: 'gen-fixture sample',
          sourceText,
          currentAnnotationId: annotationId,
        },
      },
      {
        kind: 'annotation',
        id: annotationId,
        value: {
          id: annotationId,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          dialogueId,
          model: MODEL,
          promptVersion: PROMPT_VERSION,
          schemaVersion: SCHEMA_VERSION,
          lines: new Array(splitLines.length).fill(null),
          lineErrors: new Array(splitLines.length).fill(null),
          status: 'partial',
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
          durationMs: 0,
          run: {
            state: 'queued',
            provider: 'anthropic',
            leaseUntil: null,
            hops: 0,
            steps: 0,
            lastError: null,
          },
        },
      },
    ],
    { manifest: true },
  )

  const ctx: RunnerContext = {
    records,
    stepBudgetMs: 250_000,
    origin: 'http://localhost',
    testCookie: null,
    internalSecret: undefined,
    fakeError: null,
    fakeDelayMs: null,
    clock: systemClock,
    getDeadlineMs: () => Number.POSITIVE_INFINITY, // no Vercel deadline off-platform
    createProvider,
    hop: async () => false, // never needed: no deadline means never hopping
  }

  await runStep(ctx, annotationId)

  const result = await records.getAnnotation(annotationId)
  if (!result || result.status !== 'complete') {
    console.error(
      '\nNot every line annotated successfully - fixture NOT written.',
    )
    result?.lineErrors.forEach((error, index) => {
      if (error) console.error(`  line ${index}: ${error}`)
    })
    process.exit(1)
  }

  const validLines = result.lines as LineAnnotation[]
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(validLines, null, 2)}\n`, 'utf8')

  console.log(`\nWrote ${OUTPUT_PATH}`)
  console.log(
    `usage: input=${result.usage.inputTokens} output=${result.usage.outputTokens} ` +
      `cacheRead=${result.usage.cacheReadTokens} durationMs=${result.durationMs} steps=${result.run.steps}`,
  )
}

main().catch((err: unknown) => {
  console.error('gen-fixture failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
