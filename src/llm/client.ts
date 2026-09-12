import Anthropic from '@anthropic-ai/sdk'

/**
 * Thrown when no API key is available from any source. `kind` is
 * machine-readable so callers (e.g. a Settings empty state) can branch on it
 * without string-matching `message`.
 */
export class MissingApiKeyError extends Error {
  readonly kind = 'missing_api_key' as const

  constructor() {
    super(
      'No Anthropic API key is configured. Add one in Settings, or set ' +
        'ANTHROPIC_API_KEY for local development.',
    )
    this.name = 'MissingApiKeyError'
  }
}

/**
 * Reads the build-time env var Vite injects. Guarded with optional chaining
 * (rather than a direct property access) so this module can also be
 * imported from plain Node - e.g. `scripts/gen-fixture.ts` via tsx - where
 * nothing populates `import.meta.env` and `import.meta.env` itself is
 * `undefined` (only `import.meta.env.ANTHROPIC_API_KEY` would throw).
 */
function readBuildTimeApiKey(): string | undefined {
  return import.meta.env?.ANTHROPIC_API_KEY || undefined
}

/**
 * Constructs a browser-side Anthropic client. Key resolution order: the
 * explicit `apiKeyOverride` argument (read from Settings by the caller -
 * `src/db` isn't imported here so this module stays testable and usable
 * from Node), then the build-time `ANTHROPIC_API_KEY` env var.
 *
 * Always browser-flagged (`dangerouslyAllowBrowser: true`) - this client is
 * only ever used from `src/llm/*` code running in the page. Node-side
 * callers (`scripts/gen-fixture.ts`) construct their own `Anthropic` client
 * directly instead of calling this function, since they must NOT set that
 * flag.
 */
export function createAnthropicClient(
  apiKeyOverride?: string | null,
): Anthropic {
  const apiKey = apiKeyOverride || readBuildTimeApiKey()
  if (!apiKey) {
    throw new MissingApiKeyError()
  }
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}
