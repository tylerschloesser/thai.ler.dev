---
paths:
  - 'src/llm/**'
  - 'scripts/gen-fixture.ts'
  - 'src/fixtures/**'
---

# LLM pipeline rules

Layout: `src/llm/{provider,schema,prompt,split,annotateLine,client,pipeline}.ts`,
fixtures in `src/fixtures/`, one-off generator at `scripts/gen-fixture.ts`.
`src/llm/provider.ts`'s `LineProvider` interface (`annotate({ model, lines,
lineIndex, signal?, onStart? })`) is the seam between `api/_lib/runner.ts`
and a model backend; the two implementations
(`api/_lib/providers/anthropic.ts` wrapping `annotateLine`, and
`api/_lib/providers/fake.ts`) live under `api/_lib/providers/`, not here —
see `.claude/rules/api.md` for their behavior. `onStart` fires on the
first response event (`stream.once('streamEvent', ...)` in
`annotateLine.ts`) — the runner's cache warm-up gate waits on it before
fanning out the rest of a job's lines, so the dialogue-level cache
breakpoint (below) is written before concurrent calls can race it.

`src/llm/client.ts` (the P0 in-browser Anthropic client) and
`src/llm/pipeline.ts` (its browser-side queue/resume logic) still exist and
are still what the app actually calls today — M3 is what deletes them and
moves annotation server-side. Everything in this file describes the target
`annotateLine`/schema/prompt/fixture behavior, which both the legacy
browser client and the new server providers share unchanged.

## Models and client

Model ids are exactly `claude-opus-5` (default) and `claude-sonnet-5`
(alternative, selectable in Settings) — do not invent other id strings.

**Browser client (pre-M3, still in use):** `src/llm/client.ts` constructs
`new Anthropic({ apiKey, dangerouslyAllowBrowser: true })`; the SDK adds
the required CORS header itself. Key resolution order: Settings override,
then `import.meta.env.ANTHROPIC_API_KEY` — but since P1 M0 `vite.config.ts`
has no `envPrefix` (default `VITE_` only), so that value is never inlined
and in practice the browser client works only with a Settings override
until M3 moves the call server-side (e2e seeds a dummy one, see
`testing.md`).

**Server client (M1, `api/_lib/providers/anthropic.ts`):** `new
Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 })`, built once per
runner invocation (worst case ≈ 181s, well under the 300s function cap).
Never `dangerouslyAllowBrowser` anywhere in `api/**` — that flag exists
only for the P0 in-browser client and must never appear server-side.

`scripts/gen-fixture.ts` runs in Node with a real key, against
`api/_lib/runner.ts`'s `runStep` (memory store, the `anthropic` provider)
rather than calling `annotateLine` directly, and does **not** need
`dangerouslyAllowBrowser`.

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

Calls run per-line. The runner (`api/_lib/runner.ts`) fans out with
`CONCURRENCY = 6`, but only after the first line's `onStart` fires (the
warm-up gate above) so both cache breakpoints are already being written
before the rest race in; the legacy browser pipeline used a concurrency of
4 for the same reason at a smaller scale.

## `PROMPT_VERSION`

Currently `2` (`src/llm/prompt.ts`). Bump it whenever `SYSTEM_PROMPT` or
the zod schema shape changes, and re-run `pnpm gen:fixture` to regenerate
`src/fixtures/sample.annotation.json` before committing. Stored on every
`AnnotationRecord` alongside `schemaVersion`. `api/_lib/providers/fake.ts`
imports the fixture directly (`with { type: 'json' }`) and matches lines by
Thai text, so a fixture regeneration also changes what the fake provider
returns for those eight lines — `pnpm test`'s snapshot/schema tests catch a
shape drift.

## Error mapping

Map SDK error classes (`AuthenticationError`, `RateLimitError`,
`APIConnectionError`, etc.) to readable, user-facing messages in
`annotateLine.ts`. Treat `stop_reason === 'refusal'` and hitting
`max_tokens` as errors with readable messages, not silent truncation.
Post-validate invariants (word `thai` concatenation reproduces the
sentence with spaces removed; syllables reproduce the word) and attach
`warnings[]` rather than failing the line outright.
