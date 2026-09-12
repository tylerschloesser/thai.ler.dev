import type { AnnotateLineResult } from './annotateLine.js'
import type { RunProvider } from '../lib/records.js'
import type { SplitLine } from './split.js'

/**
 * The seam between `api/_lib/runner.ts` and the model backend (PLAN.MD
 * §4.2). `api/_lib/providers/anthropic.ts` wraps the real `annotateLine`
 * call; `api/_lib/providers/fake.ts` returns fixture-backed (or synthesized)
 * lines for tests and local dev. The runner never imports either backend
 * directly - it only knows this interface.
 */
export interface LineProvider {
  readonly name: RunProvider
  annotate(opts: {
    model: string
    lines: SplitLine[]
    lineIndex: number
    signal?: AbortSignal
    /** First response event (cache warm-up gate) - see the runner's warm-up rule. */
    onStart?: () => void
  }): Promise<AnnotateLineResult>
}
