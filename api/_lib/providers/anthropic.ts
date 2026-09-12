import Anthropic from '@anthropic-ai/sdk'
import { annotateLine } from '../../../src/llm/annotateLine.js'
import type { LineProvider } from '../../../src/llm/provider.js'

/**
 * Real-model `LineProvider` (PLAN.MD §4.2, §10). Built once per invocation
 * (worst case a stream at the 90s timeout, well under the 300s function
 * cap). Never `dangerouslyAllowBrowser` - this only ever runs server-side.
 */
export function createAnthropicProvider(apiKey: string): LineProvider {
  const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 })
  return {
    name: 'anthropic',
    annotate: (opts) => annotateLine(client, opts),
  }
}
