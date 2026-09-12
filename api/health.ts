import { getDeadline } from '@vercel/functions'
import { nowIso } from '../src/lib/time.js'
import { splitDialogue } from '../src/llm/split.js'
import { readEnv } from './_lib/env.js'
import { json } from './_lib/http.js'

export const config = { maxDuration: 300 }

/**
 * The `spike` field only exists for M0's import/runtime spike (PLAN.MD §5
 * M0 item 7): does `splitDialogue` (`../src/llm/split.js`, a file outside
 * `api/`) actually load at runtime on Vercel, and is
 * `@vercel/functions`'s `getDeadline()` a live deadline there vs.
 * undefined locally? Corrected during M0: `@vercel/node` transpiles each
 * `.ts` file to its own `.js` file one-to-one, without bundling and
 * without rewriting specifiers - so every relative import under `api/`,
 * `src/lib/`, and `src/llm/` must already spell the post-transpile `.js`
 * extension (an extensionless or `.ts` specifier 404s at runtime as
 * `ERR_MODULE_NOT_FOUND`, since there's no bundler there to resolve it).
 * `getDeadline()` never throws (it returns `Date | undefined`), but the
 * try/catch stays as a defensive belt-and-suspenders in case a future
 * version changes that.
 */
function spikeHasDeadline(): boolean {
  try {
    const deadline = getDeadline()
    return deadline instanceof Date && Number.isFinite(deadline.getTime())
  } catch {
    return false
  }
}

export function GET(_request: Request): Response {
  const env = readEnv()
  return json({
    ok: true,
    now: nowIso(),
    provider: env.MODEL_PROVIDER,
    blobBackend: env.BLOB_BACKEND,
    testMode: env.ALLOW_TEST_MODE,
    sha: process.env['VERCEL_GIT_COMMIT_SHA'] ?? 'local',
    spike: {
      splitLines: splitDialogue('A: สวัสดี\nB: ครับ').length,
      hasDeadline: spikeHasDeadline(),
    },
  })
}
