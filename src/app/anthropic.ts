import type Anthropic from '@anthropic-ai/sdk'
import { createAnthropicClient, MissingApiKeyError } from '../llm/client'
import { getSetting } from '../db/settings'

// Glues Settings (src/db/settings.ts) to the LLM client (src/llm/client.ts):
// `createAnthropicClient` already implements the apiKeyOverride -> env var
// fallback order, this module just reads the current Settings row and the
// current model so callers (src/features/annotate/useAnnotate.ts) get both
// in one call. Re-exported here so callers don't need to import from
// src/llm/client.ts directly.
export { MissingApiKeyError }

export interface AnthropicClientAndModel {
  client: Anthropic
  model: string
}

/**
 * Resolves the current model and builds an Anthropic client from Settings.
 * Key resolution: `apiKeyOverride` (Settings) first, then the build-time
 * `ANTHROPIC_API_KEY` env var. Throws `MissingApiKeyError` when neither is
 * set - callers surface that as an actionable empty state pointing at
 * Settings, per .claude/rules/ui.md.
 */
export async function buildAnthropicClient(): Promise<AnthropicClientAndModel> {
  const [apiKeyOverride, model] = await Promise.all([
    getSetting('apiKeyOverride'),
    getSetting('model'),
  ])
  const client = createAnthropicClient(apiKeyOverride)
  return { client, model }
}
