/**
 * SSE builder for mocking `https://api.anthropic.com/v1/messages` shapes
 * (docs/plans/P0.md §4.6/§10). As of M3, annotation runs server-side
 * (`api/_lib/providers/anthropic.ts`) and the browser never calls
 * `api.anthropic.com` at all — `e2e/fixtures.ts` installs a guard route that
 * fails any test making such a request. `sseFromText` survives only for
 * `src/llm/anthropicMock.test.ts`'s Vitest round-trip test of the real
 * `@anthropic-ai/sdk` client against a stubbed `fetch` (proving the SDK
 * parses a structured-output SSE response the way `annotateLine.ts`
 * expects) — it has nothing to do with e2e/Playwright anymore.
 */

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
