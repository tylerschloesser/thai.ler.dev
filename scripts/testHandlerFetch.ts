import { POST as annotatePost } from '../api/annotate.js'
import { GET as annotationGet } from '../api/annotation.js'
import { POST as annotationCancelPost } from '../api/annotation/cancel.js'
import { POST as annotationResumePost } from '../api/annotation/resume.js'
import { POST as annotationStepPost } from '../api/annotation/step.js'
import { GET as syncManifestGet } from '../api/sync/manifest.js'
import { POST as syncManifestRebuildPost } from '../api/sync/manifest/rebuild.js'
import {
  GET as syncRecordGet,
  PUT as syncRecordPut,
} from '../api/sync/record.js'
import { DELETE as testNamespaceDelete } from '../api/test/namespace.js'
import { POST as testSeedPost } from '../api/test/seed.js'

/**
 * Test-only helper for `scripts/sync-integration.test.ts` (PLAN.MD §5 M2
 * acceptance): routes a relative `/api/...` request straight to the
 * matching M1 handler's method export, called with a real `Request` - the
 * in-process equivalent of `scripts/vite-api-plugin.ts`'s dev-time routing,
 * so the real client sync code (`src/sync/**`) can be driven against the
 * real server handlers without a running HTTP server. Never imported by any
 * runtime `api/**` module (`scripts/import-extensions.test.ts` only scans
 * `api/`, `src/lib/`, `src/llm/`, so this file is exempt from the `.js`-
 * extension-on-relative-imports rule it enforces, but it follows the
 * convention anyway for consistency with `scripts/gen-fixture.ts`).
 */

type Handler = (request: Request) => Promise<Response>

const ROUTES: Record<string, Partial<Record<string, Handler>>> = {
  '/api/annotate': { POST: annotatePost },
  '/api/annotation': { GET: annotationGet },
  '/api/annotation/resume': { POST: annotationResumePost },
  '/api/annotation/cancel': { POST: annotationCancelPost },
  '/api/annotation/step': { POST: annotationStepPost },
  '/api/sync/manifest': { GET: syncManifestGet },
  '/api/sync/manifest/rebuild': { POST: syncManifestRebuildPost },
  '/api/sync/record': { GET: syncRecordGet, PUT: syncRecordPut },
  '/api/test/seed': { POST: testSeedPost },
  '/api/test/namespace': { DELETE: testNamespaceDelete },
}

const BASE_URL = 'http://localhost:3000'

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

/**
 * Builds a `fetch`-compatible function bound to `cookie` (a browser sends
 * cookies automatically; this in-process shim has no cookie jar, so every
 * request it builds carries the same `thai_ns`/`thai_model`/... pair the
 * caller wants the whole test to run under). `src/sync/api.ts`'s `createApi`
 * calls this with relative paths (`/api/sync/manifest`); resolved against
 * `BASE_URL` into an absolute `Request` per the brief's "called with a real
 * Request (absolute URL)".
 */
export function createHandlerFetch(cookie: string): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(urlOf(input), BASE_URL)
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers)
    headers.set('cookie', cookie)

    const handler = ROUTES[url.pathname]?.[method]
    if (!handler) {
      throw new Error(`no test handler wired for ${method} ${url.pathname}`)
    }

    const request = new Request(url.toString(), {
      method,
      headers,
      body: init.body,
    })
    return handler(request)
  }) as typeof fetch
}
