/**
 * One-off (re-run only when the prompt/schema changes) generator: runs the
 * real annotation pipeline over `src/fixtures/sample.dialogue.txt` with a
 * real Anthropic API key and writes `src/fixtures/sample.annotation.json`.
 * Node only - does NOT set `dangerouslyAllowBrowser` (that flag is for the
 * in-browser client in `src/llm/client.ts` only). Run with `pnpm gen:fixture`.
 *
 * The API key comes from `process.env.ANTHROPIC_API_KEY` and is never
 * logged, written to a file, or otherwise echoed.
 */
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { annotateDialogue, type PipelineRepo } from '../src/llm/pipeline'
import type { LineAnnotation } from '../src/llm/schema'

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

function countLines(sourceText: string): number {
  return sourceText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length
}

function makeInMemoryRepo(lineCount: number): {
  repo: PipelineRepo
  lines: Array<LineAnnotation | null>
  errors: Array<string | null>
} {
  const lines: Array<LineAnnotation | null> = new Array(lineCount).fill(null)
  const errors: Array<string | null> = new Array(lineCount).fill(null)

  const repo: PipelineRepo = {
    async createAnnotation() {
      return { annotationId: 'gen-fixture' }
    },
    async upsertLine(input) {
      lines[input.lineIndex] = input.line
      errors[input.lineIndex] = input.error
      if (input.warnings.length > 0) {
        console.warn(
          `  line ${input.lineIndex}: ${input.warnings.length} invariant warning(s)`,
        )
        for (const warning of input.warnings) {
          console.warn(`    - ${warning}`)
        }
      }
    },
    async finalize() {
      // No-op: this script persists nothing beyond the fixture file itself.
    },
  }

  return { repo, lines, errors }
}

async function main(): Promise<void> {
  const apiKey = requireApiKey()
  // `apiKey` itself is never logged below - only success/failure per line.
  const client = new Anthropic({ apiKey })

  const sourceText = readFileSync(DIALOGUE_PATH, 'utf8')
  const lineCount = countLines(sourceText)
  const { repo, lines, errors } = makeInMemoryRepo(lineCount)

  console.log(`Annotating ${lineCount} line(s) with ${MODEL}...`)

  const result = await annotateDialogue(
    { id: 'sample', sourceText },
    {
      client,
      model: MODEL,
      repo,
      onLine: (event) => {
        console.log(
          `  line ${event.lineIndex}: ${event.error ? `FAILED - ${event.error}` : 'ok'}`,
        )
      },
    },
  )

  if (result.status !== 'complete') {
    console.error(
      '\nNot every line annotated successfully - fixture NOT written.',
    )
    errors.forEach((error, index) => {
      if (error) console.error(`  line ${index}: ${error}`)
    })
    process.exit(1)
  }

  const validLines = lines as LineAnnotation[]
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(validLines, null, 2)}\n`, 'utf8')

  console.log(`\nWrote ${OUTPUT_PATH}`)
  console.log(
    `usage: input=${result.usage.inputTokens} output=${result.usage.outputTokens} ` +
      `cacheRead=${result.usage.cacheReadTokens} durationMs=${result.durationMs}`,
  )
}

main().catch((err: unknown) => {
  console.error('gen-fixture failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
