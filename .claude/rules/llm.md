---
paths:
  - 'src/llm/**'
  - 'scripts/gen-fixture.ts'
  - 'src/fixtures/**'
---

# LLM pipeline rules

Layout: `src/llm/{client,schema,prompt,split,annotateLine,pipeline}.ts`,
fixtures in `src/fixtures/`, one-off generator at `scripts/gen-fixture.ts`.

## Models and client

Model ids are exactly `claude-opus-5` (default) and `claude-sonnet-5`
(alternative, selectable in Settings) — do not invent other id strings.
`src/llm/client.ts` constructs `new Anthropic({ apiKey,
dangerouslyAllowBrowser: true })`; the SDK adds the required CORS header
itself. Key resolution order: Settings override, then
`import.meta.env.ANTHROPIC_API_KEY` (Vite `envPrefix` includes
`ANTHROPIC_API_KEY`). `scripts/gen-fixture.ts` runs in Node with a real key
and does **not** need `dangerouslyAllowBrowser`.

## Never pass these params

Never pass `thinking` or `temperature` to `messages.stream` — adaptive
thinking is the default on Opus 5 / Sonnet 5. Leave `output_config.effort`
at its default for P0.

## Structured-output constraints (zod schemas in `schema.ts`)

Every property `required`; `additionalProperties: false`; no recursion;
`minItems` only 0 or 1; no numeric or string-length constraints (the SDK
strips these into descriptions instead of enforcing them); use
`.nullable()`, not `.optional()`. Fixed 4-level nesting (line → sentence →
word → syllable) is fine.

`annotateLine.ts` builds `output_config.format` from
`zodOutputFormat(LineAnnotationSchema)` (`@anthropic-ai/sdk/helpers/zod`)
but deliberately **strips its `.parse` method**, keeping only the wire
shape (`type`, `schema`). `zodOutputFormat`'s `.parse` is what the SDK uses
to auto-populate `parsed_output`, and it runs eagerly while the stream
accumulates — before `stream.finalMessage()` resolves — so it throws on a
real refusal or a `max_tokens` truncation (where the text is empty or cut
off) before `annotateLine.ts` gets a chance to inspect `stop_reason` and
report a proper `'refusal'` / `'max_tokens'` `AnnotateError`. Stripping
`.parse` disables that auto-parse so `finalMessage()` always resolves;
`annotateLine.ts` then checks `stop_reason` first, and only afterward
`JSON.parse`s the text block and validates it against the zod schema
itself.

## Prompt-caching layout

Per line, in this order, each a separate content block:

1. `system`: stable `SYSTEM_PROMPT` with `cache_control: { type:
'ephemeral' }` (first cache breakpoint).
2. User message, block 1: the **full dialogue** (stable per dialogue) with
   its own `cache_control: { type: 'ephemeral' }` (second breakpoint).
3. User message, block 2: the `<target line="N">` instruction — varies per
   call, not cached.

Calls run per-line, concurrency-limited (4), not one call per dialogue.

## `PROMPT_VERSION`

Currently `2` (`src/llm/prompt.ts`). Bump it whenever `SYSTEM_PROMPT` or
the zod schema shape changes, and re-run `pnpm gen:fixture` to regenerate
`src/fixtures/sample.annotation.json` before committing. Stored on every
`AnnotationRecord` alongside `schemaVersion`.

## Error mapping

Map SDK error classes (`AuthenticationError`, `RateLimitError`,
`APIConnectionError`, etc.) to readable, user-facing messages in
`annotateLine.ts`. Treat `stop_reason === 'refusal'` and hitting
`max_tokens` as errors with readable messages, not silent truncation.
Post-validate invariants (word `thai` concatenation reproduces the
sentence with spaces removed; syllables reproduce the word) and attach
`warnings[]` rather than failing the line outright.
