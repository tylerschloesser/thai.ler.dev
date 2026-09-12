import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.js'
import {
  checkInvariants,
  LineAnnotationSchema,
  type LineAnnotation,
} from './schema.js'
import type { SplitLine } from './split.js'

export type AnnotateErrorKind =
  | 'authentication'
  | 'rate_limited'
  | 'connection'
  | 'bad_request'
  | 'permission_denied'
  | 'refusal'
  | 'max_tokens'
  | 'aborted'
  | 'invalid_response'
  | 'unknown'

/** A readable, machine-typed annotation failure. `kind` lets callers branch without string-matching `message`. */
export class AnnotateError extends Error {
  readonly kind: AnnotateErrorKind

  constructor(
    kind: AnnotateErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.kind = kind
    this.name = 'AnnotateError'
  }
}

export interface AnnotateLineUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export interface AnnotateLineResult {
  line: LineAnnotation
  /** Invariant-check warnings (never a hard failure - see checkInvariants). */
  warnings: string[]
  usage: AnnotateLineUsage
}

export interface AnnotateLineOptions {
  model: string
  lines: SplitLine[]
  lineIndex: number
  signal?: AbortSignal
  /** First stream event (cache warm-up gate) - see api/_lib/runner.ts. */
  onStart?: () => void
}

/** Wire shape of `output_config.format`, deliberately narrower than the SDK's `AutoParseableOutputFormat` - see the comment on `outputFormat` below. */
interface JsonSchemaOutputFormat {
  type: 'json_schema'
  schema: Record<string, unknown>
}

/** Maps an SDK error (or an AnnotateError already thrown deeper) to a readable, typed AnnotateError. Most-specific class first, per shared/error-codes.md. */
function mapError(err: unknown): AnnotateError {
  if (err instanceof AnnotateError) return err
  if (err instanceof Anthropic.APIUserAbortError) {
    return new AnnotateError('aborted', 'The request was cancelled.', {
      cause: err,
    })
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AnnotateError(
      'connection',
      'The request to the Anthropic API timed out.',
      { cause: err },
    )
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AnnotateError(
      'connection',
      'Could not reach the Anthropic API. Check your network connection.',
      { cause: err },
    )
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new AnnotateError(
      'authentication',
      'The Anthropic API key is missing or invalid. Check it in Settings.',
      { cause: err },
    )
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AnnotateError(
      'permission_denied',
      'The Anthropic API key does not have permission for this request.',
      { cause: err },
    )
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AnnotateError(
      'rate_limited',
      'Rate limited by the Anthropic API. Try again shortly.',
      { cause: err },
    )
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AnnotateError(
      'bad_request',
      `The Anthropic API rejected the request: ${err.message}`,
      { cause: err },
    )
  }
  if (err instanceof Anthropic.APIError) {
    return new AnnotateError('unknown', `Anthropic API error: ${err.message}`, {
      cause: err,
    })
  }
  if (err instanceof Error) {
    return new AnnotateError('unknown', err.message, { cause: err })
  }
  return new AnnotateError('unknown', 'An unknown error occurred.', {
    cause: err,
  })
}

/**
 * Annotates a single dialogue line with one streamed structured-output
 * call, per docs/plans/P0.md §4.2. Never passes `thinking` or `temperature` -
 * adaptive thinking is the default on Opus 5 / Sonnet 5 (.claude/rules/llm.md).
 */
export async function annotateLine(
  client: Anthropic,
  opts: AnnotateLineOptions,
): Promise<AnnotateLineResult> {
  const { dialogueBlock, targetBlock } = buildUserMessage(
    opts.lines,
    opts.lineIndex,
  )

  // zodOutputFormat() returns the JSON schema plus a `.parse()` method the
  // SDK uses to auto-populate `parsed_output`. That auto-parse runs eagerly
  // while the stream accumulates - *before* finalMessage() resolves - and
  // throws if the content isn't valid JSON yet. On a real refusal or a
  // max_tokens truncation the model's text is empty or a truncated
  // fragment, so that throw would happen before we get a chance to inspect
  // `stop_reason` and report a proper 'refusal' / 'max_tokens'
  // AnnotateError - it would surface as an opaque parse-failure instead.
  // Stripping `.parse` (keeping only the wire-shape `type`/`schema`)
  // disables the auto-parse so finalMessage() always resolves, and we parse
  // the text ourselves below, after checking `stop_reason` first.
  const { type, schema } = zodOutputFormat(LineAnnotationSchema)
  const outputFormat: JsonSchemaOutputFormat = { type, schema }

  const stream = client.messages.stream(
    {
      model: opts.model,
      max_tokens: 16000,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: [dialogueBlock, targetBlock] }],
      output_config: { format: outputFormat },
    },
    { signal: opts.signal },
  )

  if (opts.onStart) {
    const onStart = opts.onStart
    stream.once('streamEvent', () => onStart())
  }

  if (opts.signal) {
    const abortStream = () => stream.abort()
    if (opts.signal.aborted) {
      abortStream()
    } else {
      opts.signal.addEventListener('abort', abortStream, { once: true })
    }
  }

  let message
  try {
    message = await stream.finalMessage()
  } catch (err) {
    throw mapError(err)
  }

  if (message.stop_reason === 'refusal') {
    throw new AnnotateError(
      'refusal',
      message.stop_details?.explanation ??
        'The model declined to annotate this line.',
    )
  }
  if (message.stop_reason === 'max_tokens') {
    throw new AnnotateError(
      'max_tokens',
      'The response was truncated at the token limit before it finished. Try again.',
    )
  }

  const textBlock = message.content.find(
    (
      block,
    ): block is Extract<(typeof message.content)[number], { type: 'text' }> =>
      block.type === 'text',
  )
  if (!textBlock) {
    throw new AnnotateError(
      'invalid_response',
      'The model response did not include any text content.',
    )
  }

  let rawOutput: unknown
  try {
    rawOutput = JSON.parse(textBlock.text)
  } catch {
    throw new AnnotateError(
      'invalid_response',
      'The model response was not valid JSON.',
    )
  }

  const validation = LineAnnotationSchema.safeParse(rawOutput)
  if (!validation.success) {
    throw new AnnotateError(
      'invalid_response',
      `The model response did not match the expected schema: ${validation.error.message}`,
    )
  }

  const parsed = validation.data
  const { warnings } = checkInvariants(parsed)

  return {
    line: parsed,
    warnings,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    },
  }
}
