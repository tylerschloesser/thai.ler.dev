import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LineAnnotation } from '../../src/llm/schema'

/**
 * SSE builder + Playwright route handler for mocking
 * `https://api.anthropic.com/v1/messages` in e2e tests (PLAN.MD §4.6/§10).
 * Exported separately so `e2e/fixtures.ts` can wire `anthropicMockRoute`
 * into its default `context.route(...)` handler while other tests can
 * still reach for `sseFromText` directly to build custom responses (e.g.
 * error injection specs).
 */

// Minimal structural type for a Playwright `Route` - avoids a hard
// dependency on `@playwright/test`'s types here so this module (and its
// Vitest unit test) can also run under plain Node/Vitest without pulling in
// Playwright's runtime.
export interface MockRoute {
  request(): {
    postDataJSON(): unknown
  }
  fulfill(options: {
    status: number
    contentType: string
    body: string
  }): Promise<void>
}

interface AnthropicContentBlock {
  type: string
  text?: string
}

interface AnthropicRequestBody {
  model?: string
  messages?: Array<{ role: string; content?: string | AnthropicContentBlock[] }>
}

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(
  here,
  '..',
  '..',
  'src',
  'fixtures',
  'sample.annotation.json',
)

let cachedFixtureLines: LineAnnotation[] | null = null

/** Lazily loads and caches `src/fixtures/sample.annotation.json`. Loaded via `fs`, not a static JSON import, so this module works identically under Vitest and Playwright without relying on either runtime's JSON-import handling. */
function loadFixtureLines(): LineAnnotation[] {
  if (!cachedFixtureLines) {
    const raw = readFileSync(FIXTURE_PATH, 'utf8')
    cachedFixtureLines = JSON.parse(raw) as LineAnnotation[]
  }
  return cachedFixtureLines
}

/**
 * Builds a Server-Sent Events body reproducing the shape a real
 * `messages.stream()` call receives: `message_start` -> `content_block_start`
 * -> chunked `content_block_delta` text events -> `content_block_stop` ->
 * `message_delta` (with `stop_reason: 'end_turn'`) -> `message_stop`. Pass
 * `JSON.stringify(lineAnnotation)` as `text` to mock a structured-output
 * response - the SDK parses the assembled text as the model's JSON output.
 */
export function sseFromText(text: string, model = 'claude-opus-5'): string {
  const event = (type: string, data: object) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const chunks = text.match(/[\s\S]{1,400}/g) ?? ['']
  return [
    event('message_start', {
      message: {
        id: 'msg_mock',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    }),
    event('content_block_start', {
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
    ...chunks.map((chunk) =>
      event('content_block_delta', {
        index: 0,
        delta: { type: 'text_delta', text: chunk },
      }),
    ),
    event('content_block_stop', { index: 0 }),
    event('message_delta', {
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 50 },
    }),
    event('message_stop', {}),
  ].join('')
}

function extractContentBlocks(
  body: AnthropicRequestBody,
): AnthropicContentBlock[] {
  const content = body.messages?.[0]?.content
  if (!content) return []
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content
}

/** Extracts N from a `<target line="N">` block, if present. */
function extractTargetIndex(body: AnthropicRequestBody): number | null {
  for (const block of extractContentBlocks(body)) {
    if (block.type !== 'text' || !block.text) continue
    const match = /<target line="(\d+)">/.exec(block.text)
    if (match?.[1] !== undefined) {
      const index = Number(match[1])
      if (!Number.isNaN(index)) return index
    }
  }
  return null
}

/** Fallback: finds the fixture line whose Thai text appears verbatim in the request content, for requests that don't use the `<target line="N">` convention. */
function findIndexByThaiText(
  body: AnthropicRequestBody,
  fixtureLines: LineAnnotation[],
): number | null {
  const combinedText = extractContentBlocks(body)
    .map((block) => block.text ?? '')
    .join('\n')
  const index = fixtureLines.findIndex(
    (line) => line.thai.length > 0 && combinedText.includes(line.thai),
  )
  return index === -1 ? null : index
}

/**
 * Playwright route handler for `https://api.anthropic.com/v1/messages`.
 * Reads the request body, finds which dialogue line is the target (by
 * `<target line="N">` index, falling back to matching the target line's
 * Thai text), and fulfills with an SSE body carrying that line's fixture
 * annotation as structured-output JSON text.
 */
export async function anthropicMockRoute(route: MockRoute): Promise<void> {
  const body = route.request().postDataJSON() as AnthropicRequestBody
  const fixtureLines = loadFixtureLines()

  const index =
    extractTargetIndex(body) ?? findIndexByThaiText(body, fixtureLines)
  const line = index !== null ? fixtureLines[index] : undefined

  if (!line) {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'error',
        error: {
          type: 'not_found_error',
          message:
            'anthropicMockRoute: could not find a fixture line matching this request.',
        },
      }),
    })
    return
  }

  await route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: sseFromText(JSON.stringify(line), body.model ?? 'claude-opus-5'),
  })
}
