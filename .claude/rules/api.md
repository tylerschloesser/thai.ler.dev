---
paths:
  - 'api/**'
  - 'scripts/vite-api-plugin.ts'
  - 'scripts/load-env.ts'
  - 'tsconfig.api.json'
---

# API rules

`api/` holds Vercel Functions (PLAN.MD §4.1, §10). As of M0 it has
`health.ts`, `annotation.ts`, `annotation/resume.ts` (both routing-spike
stubs that answer `501`), and `_lib/{http,env,context}.ts` +
`_lib/store/{index,memory,disk,vercel,paths}.ts`. M1 adds `annotate.ts`,
`annotation/{cancel,step}.ts`, `sync/**`, `test/{seed,namespace}.ts`,
`_lib/records.ts`, `_lib/runner.ts`, `_lib/hop.ts`, and
`_lib/providers/{index,anthropic,fake}.ts` — every rule below that describes
one of those files says "M1 adds" and is a rule for when it lands, not a
claim that it exists today.

## Handler shape

Every handler is a named export matching the HTTP method:
`export function GET/POST/PUT/DELETE(request: Request): Response |
Promise<Response>`. A bare `export default` is a Node `(req, res)` handler
to Vercel, not a web-standard one — never use it. Every handler file also
exports `export const config = { maxDuration: 300 }` (`health.ts`,
`annotation.ts`, `annotation/resume.ts` all do this today).

## Routing

Flat files under `api/`; ids travel as query params, never dynamic `[id]`
segments. `_lib/` (any path segment starting with `_`) is never routed —
`scripts/vite-api-plugin.ts`'s `resolveApiFile` rejects `_`-prefixed
segments locally, and on Vercel the leading underscore itself excludes the
file from routing. `api/annotation.ts` and `api/annotation/resume.ts`
coexist as separate routes (`/api/annotation`, `/api/annotation/resume`) —
verified on a real preview in M0. `vercel.json`'s SPA rewrite excludes
`api/`, so an unknown `/api/*` path is a real JSON `404`, never
`index.html` (`e2e/api-health.spec.ts`, `e2e/live/health.spec.ts` both
assert this).

## Imports

Relative imports inside `api/**`, `src/lib/**`, and `src/llm/**` must end in
the post-transpile `.js` extension even though every source file is `.ts`
(e.g. `import { json } from './_lib/http.js'`, `import { splitDialogue }
from '../src/llm/split.js'`). Vercel's Node builder transpiles each `.ts`
file to its own `.js` file one-to-one, without bundling and without
rewriting specifiers, so a `.ts` or extensionless relative specifier
crashes at runtime with `ERR_MODULE_NOT_FOUND` — observed on a real preview
during the M0 spike. This supersedes PLAN.MD §6.2's ".ts extensions"
wording; a Vitest guard (`scripts/import-extensions.test.ts`) is being
added to enforce it — until it lands, check every new relative import by
hand. `api/**` only imports from `../src/lib` and `../src/llm`, never
`src/db`, `src/ui`, or `src/features`.

## Error and JSON shape

`api/_lib/http.ts`: `json(data, status?)` and `fail(kind, message)` build
responses; `failFromError(err)` maps a thrown `HttpError` (or anything
else, as `'internal'`) to `fail()`; `readJson(request, schema)` parses and
zod-validates a body, throwing `HttpError('bad_request', ...)` on failure.
`ErrorKind` is `bad_request | not_found | unauthorized | busy | provider |
store | internal`, mapped to `400 | 404 | 401 | 409 | 502 | 502 | 500`.
Every response — success or error — carries `cache-control: private,
no-store`; never let a handler return without going through `json`/`fail`.

## Request context

`api/_lib/context.ts`'s `createContext(request)` builds a `RequestContext`
per request: `env`, `testMode`, `ns`, `prefix`, `store`, `stepBudgetMs`,
`modelOverride`, `fakeError`, `testCookie`, `origin`. Cookies are parsed —
and only take effect — when `env.ALLOW_TEST_MODE` is true; otherwise every
`thai_*` cookie is ignored outright, so a stray cookie can never affect a
production request:

| Cookie                | Values                                           | Effect                                                                     |
| --------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| `thai_ns`             | `^[a-z0-9-]{1,64}$`                              | Store prefix becomes `ns/<value>/v1/…` instead of `v1/…` (test isolation). |
| `thai_model`          | `fake` \| `fake-slow`                            | Provider override, read by M1's provider selection.                        |
| `thai_fake_error`     | an `AnnotateErrorKind` string (unvalidated here) | M1's fake provider fails every line with that kind while set.              |
| `thai_step_budget_ms` | positive integer                                 | Caps `stepBudgetMs`, forcing hops in tests (consumed by M1's runner).      |

Only `thai_ns` and `thai_model` are validated in `context.ts` today
(invalid values fall back to `null`); `thai_fake_error` is passed through
unvalidated for M1's provider to interpret.

## Env vars (`api/_lib/env.ts`)

| Var               | Type / values                  | Default                                                          |
| ----------------- | ------------------------------ | ---------------------------------------------------------------- |
| `MODEL_PROVIDER`  | `anthropic` \| `fake`          | `anthropic` if `ANTHROPIC_API_KEY` is set, else `fake`           |
| `BLOB_BACKEND`    | `memory` \| `disk` \| `vercel` | `vercel` when `process.env.VERCEL === '1'`, else `disk`          |
| `ALLOW_TEST_MODE` | boolean (`'1'`)                | `false`; throws at startup if `true` and `VERCEL_ENV=production` |
| `INTERNAL_SECRET` | string \| `undefined`          | `'local-dev'` off Vercel, `undefined` on Vercel unless set       |
| `STEP_BUDGET_MS`  | positive integer               | `250000`                                                         |

`readEnv()` only reads `process.env` — it never touches `.env*` files
itself; that's `scripts/load-env.ts`'s job locally.

## BlobStore (`api/_lib/store/**`)

Three backends behind one `BlobStore` interface (`getJson`, `putJson`,
`list`, `del`), selected by `BLOB_BACKEND` via `createStore()`: `memory`
(a `Map` on `globalThis`, used by the Playwright fast suite and Vitest),
`disk` (`.data/blob/`, gitignored, `pnpm dev`'s default so jobs survive a
restart), and `vercel` (the real `@vercel/blob` SDK). Every backend throws
`StorePreconditionError` when `putJson`'s `ifMatch` doesn't match (or the
path doesn't exist). The `vercel` backend specifically:

- Every `get` passes `{ access: 'private', useCache: false }` — private
  Blob is documented read-after-write consistent only when bypassing the
  CDN cache, which matters because a request often reads back what it (or
  a concurrent runner) just wrote.
- Every `put` passes `{ access: 'private', allowOverwrite: true,
addRandomSuffix: false, contentType: 'application/json', ifMatch }`.
- `BlobPreconditionFailedError` is mapped to `StorePreconditionError` so
  callers never need to know which backend they're talking to.
- `store.vercel.test.ts` is skipped unless `BLOB_READ_WRITE_TOKEN` is set,
  and cleans up everything it wrote in a random namespace prefix.

M1 adds `_lib/records.ts` on top of this: `putRecord` writes the record
blob, then updates the manifest with `ifMatch` (re-read-and-retry once on a
precondition failure), and intermediate runner flushes touch only the
record blob, never the manifest. Respect the Hobby ops budget (PLAN.MD
§4.3): `put`/`list` are advanced ops (2,000/month), uncached `get`/`head`
are simple ops (10,000/month), `del` is free — a single 20-line annotation
job should cost roughly 10 advanced ops, not one per line.

## Runner invariants (M1 adds `_lib/runner.ts` + `_lib/hop.ts`)

Take the lease before doing any work and check it (`leaseUntil`) on entry
so two runners never race the same record; never start a new line when
less than `LINE_RESERVE_MS` remains before the deadline; flush (write the
record) on a cadence, on every line error, and at the end — not after every
line; at most one continuation hop per step, `MAX_HOPS = 3` per lineage;
never set `supportsCancellation` in `vercel.json` for any `api/**` path (a
client tab closing must not cancel an in-flight run).

`getDeadline()` from `@vercel/functions` 3.9.7 is typed `(): Date |
undefined`; on Vercel it returns the invocation deadline (verified on a
preview in M0: `spike.hasDeadline: true`), and outside Vercel it
is always `undefined` — `api/health.ts`'s `spikeHasDeadline()` treats any
non-`Date` return as `false`, and M1's runner falls back to
`STEP_BUDGET_MS` whenever `getDeadline()` doesn't return a usable date.

## Secrets

Never log a header or an env value, in a handler, a test, or a console
warning — `scripts/vite-api-plugin.ts`'s dev-provider warning logs only the
_absence_ of `ANTHROPIC_API_KEY`, never any value. `INTERNAL_SECRET` and
`VERCEL_AUTOMATION_BYPASS_SECRET` (M1's hop authentication) must be
compared with `crypto.timingSafeEqual`, never `===`, once `annotation/
step.ts` exists.

## Local loader notes

`pnpm dev` serves `/api/*` via `configureServer` + `server.ssrLoadModule`
(handlers get HMR); `pnpm preview` and Playwright's `webServer` use
`configurePreviewServer` + `tsImport` from `tsx/esm/api`, cached per
resolved file for the process lifetime, because Node 22 can't resolve the
extensionless-looking-but-actually-`.js`-suffixed relative imports on its
own and `tsImport` re-evaluates a module on every call otherwise (which
would reset the `memory` backend's module state per request).
`scripts/load-env.ts` reads `.env.development.local` then `.env.local`
(never overriding an already-set key, never logging a value, skipping
`VERCEL`/`VERCEL_*` except `VERCEL_AUTOMATION_BYPASS_SECRET` and
`VERCEL_OIDC_TOKEN`, and `TURBO_*`/`NX_DAEMON`) before
`applyDevEnvDefaults()` fills in `BLOB_BACKEND=disk`,
`ALLOW_TEST_MODE=1`, `STEP_BUDGET_MS=250000`, and `MODEL_PROVIDER`.
`waitUntil` (M1) is a no-op outside Vercel — the promise just keeps running
in the local process, so dev and Playwright exercise the same code path
without it.
