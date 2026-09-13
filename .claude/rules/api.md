---
paths:
  - 'api/**'
  - 'scripts/vite-api-plugin.ts'
  - 'scripts/load-env.ts'
  - 'tsconfig.api.json'
---

# API rules

`api/` holds Vercel Functions (PLAN.MD §4.1, §4.2, §10). M0 and M1 have
both landed: `health.ts`, `annotate.ts`, `annotation.ts`, `annotation/
{resume,cancel,step}.ts`, `sync/{manifest,record}.ts`,
`sync/manifest/rebuild.ts`, `test/{seed,namespace}.ts`, and
`_lib/{http,env,context,records,runner,hop,internalAuth,jsonBody,
schemas}.ts` + `_lib/providers/{index,anthropic,fake}.ts` +
`_lib/store/{index,memory,disk,vercel,paths}.ts`. `api/**` never imports
`src/db` (M2's Dexie layer) — the only files that cross that boundary are
the M1↔M2 integration test (`scripts/sync-integration.test.ts`) and its
test-only helper (`scripts/testHandlerFetch.ts`), neither of which is a
runtime `api/**` file.

## Handler shape

Every handler is a named export matching the HTTP method:
`export function GET/POST/PUT/DELETE(request: Request): Response |
Promise<Response>`. A bare `export default` is a Node `(req, res)` handler
to Vercel, not a web-standard one — never use it. Every handler file also
exports `export const config = { maxDuration: 300 }`.

## Routing

Flat files under `api/`; ids travel as query params, never dynamic `[id]`
segments. `_lib/` (any path segment starting with `_`) is never routed —
`scripts/vite-api-plugin.ts`'s `resolveApiFile` rejects `_`-prefixed
segments locally, and on Vercel the leading underscore itself excludes the
file from routing. `api/annotation.ts` and `api/annotation/*.ts` coexist as
separate routes (`/api/annotation`, `/api/annotation/resume`, `/annotation/
cancel`, `/annotation/step`) — verified on a real preview in M0.
`vercel.json`'s SPA rewrite excludes `api/`, so an unknown `/api/*` path is
a real JSON `404`, never `index.html` (`e2e/api-health.spec.ts`,
`e2e/live/health.spec.ts` both assert this).

## Imports

Relative imports inside `api/**`, `src/lib/**`, and `src/llm/**` must end in
the post-transpile `.js` extension even though every source file is `.ts`
(e.g. `import { json } from './_lib/http.js'`, `import { splitDialogue }
from '../src/llm/split.js'`). Vercel's Node builder transpiles each `.ts`
file to its own `.js` file one-to-one, without bundling and without
rewriting specifiers, so a `.ts` or extensionless relative specifier
crashes at runtime with `ERR_MODULE_NOT_FOUND` — observed on a real preview
during the M0 spike. `scripts/import-extensions.test.ts` enforces this
across `api/`, `src/lib/`, `src/llm/` (a `.json` specifier is allowed only
with `with { type: 'json' }` — see `_lib/providers/fake.ts`'s fixture
import below). `api/**` only imports from `../src/lib` and `../src/llm`,
never `src/db`, `src/ui`, or `src/features`.

## Error and JSON shape

`api/_lib/http.ts`: `json(data, status?)` and `fail(kind, message)` build
responses; `failFromError(err)` maps a thrown `HttpError` (or anything
else, as `'internal'`) to `fail()`; `readJson(request, schema)` parses and
zod-validates a body, throwing `HttpError('bad_request', ...)` on failure.
`ErrorKind` is `bad_request | not_found | unauthorized | busy | provider |
store | internal`, mapped to `400 | 404 | 401 | 409 | 502 | 502 | 500`.
Every response — success or error — carries `cache-control: private,
no-store`; never let a handler return without going through `json`/`fail`.
`api/_lib/jsonBody.ts`'s `jsonBody(res)` is a test-only helper (a typed
`res.json()`) for handler tests reading arbitrary response shapes.

## Request context

`api/_lib/context.ts`'s `createContext(request)` builds a `RequestContext`
per request: `env`, `testMode`, `ns`, `prefix`, `store`, `stepBudgetMs`,
`modelOverride`, `fakeError`, `fakeDelayMs`, `testCookie`, `origin`.
Cookies are parsed — and only take effect — when `env.ALLOW_TEST_MODE` is
true; otherwise every `thai_*` cookie is ignored outright, so a stray
cookie can never affect a production request:

| Cookie                | Values                                      | Effect                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `thai_ns`             | `^[a-z0-9-]{1,64}$`                         | Store prefix becomes `ns/<value>/v1/…` instead of `v1/…` (test isolation).                                                                                                                                                                                                                                                |
| `thai_model`          | `fake` \| `fake-slow`                       | Provider override for a _new_ job (`selectNewJobProvider`); an existing job always rebuilds its provider from the persisted `run.provider`.                                                                                                                                                                               |
| `thai_fake_error`     | an `AnnotateErrorKind` string (unvalidated) | The fake provider fails every line with that kind while set.                                                                                                                                                                                                                                                              |
| `thai_step_budget_ms` | positive integer                            | Caps `stepBudgetMs`, forcing hops in tests.                                                                                                                                                                                                                                                                               |
| `thai_fake_delay_ms`  | integer 0–60000                             | Overrides the fake provider's per-line delay (0ms for `fake`, 300ms for `fake-slow`) — needed because `lineReserveMs` scales down with a tiny test budget (see the runner section below), so a fixed delay is the only way left to force an observable multi-step job in a test. Forwarded on every hop via `testCookie`. |

## Env vars (`api/_lib/env.ts`)

| Var               | Type / values                  | Default                                                                                                                                                                |
| ----------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MODEL_PROVIDER`  | `anthropic` \| `fake`          | `anthropic` if `ANTHROPIC_API_KEY` is set, else `fake`                                                                                                                 |
| `BLOB_BACKEND`    | `memory` \| `disk` \| `vercel` | `vercel` when `process.env.VERCEL === '1'`, else `disk`                                                                                                                |
| `ALLOW_TEST_MODE` | boolean (`'1'`)                | `false`; throws at startup if `true` and `VERCEL_ENV=production`                                                                                                       |
| `INTERNAL_SECRET` | string \| `undefined`          | `'local-dev'` off Vercel, `undefined` on Vercel unless set                                                                                                             |
| `STEP_BUDGET_MS`  | positive integer               | `250000`                                                                                                                                                               |
| `BLOB_DISK_ROOT`  | string \| `undefined`          | `undefined` (the `disk` backend defaults to `.data/blob/`); overrides the disk backend's root so `scripts/smoke-runner.ts` can point it at a throwaway temp directory. |

`readEnv()` only reads `process.env` — it never touches `.env*` files
itself; that's `scripts/load-env.ts`'s job locally.

## BlobStore (`api/_lib/store/**`)

Three backends behind one `BlobStore` interface (`getJson`, `putJson`,
`list`, `del`), selected by `BLOB_BACKEND` via `createStore()`: `memory`
(a `Map` on `globalThis`, used by the Playwright fast suite and Vitest —
`resetMemoryStoreForTests()` clears it between test files), `disk`
(`BLOB_DISK_ROOT` or `.data/blob/`, gitignored, `pnpm dev`'s default so
jobs survive a restart), and `vercel` (the real `@vercel/blob` SDK). Every
backend throws `StorePreconditionError` when `putJson`'s `ifMatch` doesn't
match (or the path doesn't exist). The `vercel` backend specifically:

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

`api/_lib/records.ts` on top of this: `getDialogue`/`getAnnotation`/
`getSettings` clone on every read (the `memory` backend stores by
reference, unlike `disk`/`vercel`, so a caller mutating a fetched record in
place — the runner does, heavily — would otherwise corrupt the "stored"
copy). `putRecords(entries, { manifest })` writes every entry's blob, then
— only when `manifest: true` — folds **all** of them into one manifest
read-modify-write (`ifMatch`, retried once on a precondition failure, then
`HttpError('store', ...)`). `resolveDialogueUpsert`/`resolveAnnotationUpsert`
apply `pickWinner` (`src/lib/merge.ts`) against the stored copy;
`resolveSettingsUpsert` applies `mergeSettingRows`. `rebuildManifest()`
lists `<prefix>dialogues/`, `<prefix>annotations/`, reads
`<prefix>settings.json`, and rewrites the manifest from scratch —
maintenance only, wired to `POST /api/sync/manifest/rebuild`. Respect the
Hobby ops budget (PLAN.MD §4.3): `put`/`list` are advanced ops
(2,000/month), uncached `get`/`head` are simple ops (10,000/month), `del`
is free — `POST /api/annotate` costs 3 advanced ops (2 record puts folded
into 1 manifest put), not 4, and a 20-line job costs roughly 10 advanced
ops total, not one per line.

## Providers (`api/_lib/providers/**`)

One `LineProvider` interface (`src/llm/provider.ts`): `annotate({ model,
lines, lineIndex, signal?, onStart? })`. `createProvider(name, opts)`
(`_lib/providers/index.ts`) builds `'anthropic'` (throws
`MissingApiKeyError` — a step-level failure, never per-line — if
`ANTHROPIC_API_KEY` is unset) or `'fake'`/`'fake-slow'`.
`selectNewJobProvider(ctx)` (`thai_model` cookie, else `ctx.env.MODEL_PROVIDER`)
only picks the provider for a _brand-new_ job; an existing job's hop/resume
always rebuilds from the persisted `run.provider`, ignoring the current
request's cookies.

`_lib/providers/anthropic.ts`: `new Anthropic({ apiKey, timeout: 90_000,
maxRetries: 1 })`, built once per invocation (worst case ≈ 181s, well under
the 300s function cap); never `dangerouslyAllowBrowser` (server-only).
Delegates to `src/llm/annotateLine.ts`.

`_lib/providers/fake.ts`: matches a split line to
`src/fixtures/sample.annotation.json` by Thai text (imported with `with {
type: 'json' }` — the one exception to the "every relative import ends in
`.js`" rule, since a real JSON import needs Node ESM's import-attribute
syntax instead); for any other text, synthesizes a minimal schema-valid
`LineAnnotation` (translation `[fake] <text>`, one sentence/word/syllable)
so e2e can use dialogues of any length, not just the fixture's eight
lines. Default delay is 0ms (`fake`) / 300ms (`fake-slow`), overridable by
`thai_fake_delay_ms`; honours `thai_fake_error` by throwing an
`AnnotateError` of that kind for every line.

## Runner (`api/_lib/runner.ts`, `runStep(ctx, annotationId)`)

Invoked inside `waitUntil` by `annotate`, `resume`, and `step`. One pass:

1. Load the record fresh; return immediately if `run.state ∈ done |
cancelled`, or if another runner's lease is still live (`leaseUntil > now +
LEASE_GRACE_MS` (5s)).
2. Take the lease: `state: 'running'`, `steps += 1`, `leaseUntil = now +
budget + LEASE_EXTRA_MS` (30s); persist (the "initial lease-take write").
   `budget = min(getDeadlineMs() - now - DEADLINE_SAFETY_MARGIN_MS` (20s),
   `stepBudgetMs)`; `getDeadlineMs()` is `getDeadline()?.getTime() ??
Infinity` — live on Vercel, always `Infinity` locally (`STEP_BUDGET_MS`/the
   `thai_step_budget_ms` cookie is what actually caps a local step, then).
3. `lineReserveMs = min(MAX_LINE_RESERVE_MS` (70000), `floor(budget / 2))`
   — a fixed 70s reserve would never let a line start under a test budget
   of a few seconds, so it scales down with the budget instead. **Every
   step starts at least one pending line regardless of the reserve** (the
   reserve only gates the _second and later_ lines in a step) — this is
   the runner's progress guarantee, and it's what makes `job-hop`-style
   tests possible at all under a tiny budget.
4. Warm-up: if no line has succeeded yet and more than one is pending, run
   the first alone until its `onStart` fires, then fan out the rest with
   `CONCURRENCY = 6` workers.
5. Each worker re-checks cancellation at least every
   `CANCEL_CHECK_INTERVAL_MS` (5s) and before starting a line — **cancel
   may land on a different instance than the one running the job**, so the
   runner re-reads the stored `run.state` (never trusting only its
   in-memory copy) at that cadence, at every flush, and once more before
   its final write, and never overwrites an observed `'cancelled'` back to
   anything else. Flush (write the record, not the manifest) when the last
   flush is more than `FLUSH_EVERY_MS` (25s) old, on every line error, and
   at the very end — a 20-line job costs ~6–8 record writes, not 20.
6. At the end: if lines remain and the run wasn't cancelled, write a
   visibly-stalled record (`leaseUntil = now`) and, if `run.hops <
MAX_HOPS` (3), call `hop()` once — its result (true/false) is not itself
   checked; a failed hop just leaves the job stalled for resume-on-open.
   Otherwise (`done` or `cancelled`): `state`, `status` (`complete` iff
   every line is non-null), final record write **with** a manifest update
   (`{ manifest: true }` — the only other manifest write besides job
   creation).

`api/_lib/hop.ts`'s `hop(deps, annotationId)`: `POST
${base}/api/annotation/step?id=`, where `base` is `https://$VERCEL_URL` if
set, else the request's own origin (so it works locally too); headers
`x-thai-internal: $INTERNAL_SECRET` (omitted if undefined) and
`x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET` (omitted if
unset) — self-invocation is legal but undocumented on Vercel, and
recursion protection there answers a `508` past an unpublished hop count,
hence `MAX_HOPS`. The triggering request's restricted-to-`thai_*` cookie
header (`ctx.testCookie`) is forwarded too, so a hop keeps the same test
namespace/overrides. Never throws — a network failure or non-2xx just
returns `false`, leaving the job stalled for resume-on-open. `step.ts`
guards itself independently with `MAX_HOPS` (defense in depth, since the
runner already declines to hop past that point) and never sets
`supportsCancellation` in `vercel.json` for any `api/**` path (a client tab
closing must not cancel an in-flight run).

## Secrets

Never log a header or an env value, in a handler, a test, or a console
warning — `scripts/vite-api-plugin.ts`'s dev-provider warning logs only the
_absence_ of `ANTHROPIC_API_KEY`, never any value. `api/_lib/internalAuth.ts`'s
`requireInternalSecret(request, expected)` guards `POST
/api/annotation/step`: compares `x-thai-internal` against `INTERNAL_SECRET`
with `crypto.timingSafeEqual` (never `===`), checking buffer length first
since `timingSafeEqual` throws rather than returning `false` on a mismatch.

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
`waitUntil` is a no-op outside Vercel (`@vercel/functions`'s `waitUntil`
calls `getContext().waitUntil?.(promise)`, which is `undefined` off-
platform) — the promise passed to it was already constructed and started
running regardless, so dev, Playwright, and Vitest all exercise the same
code path without ever blocking a handler's response on it.

## Node smoke test and cross-milestone integration test

`pnpm exec tsx scripts/smoke-runner.ts` builds the app, starts `pnpm
preview` on port 4175 (`E2E_PORT` is Playwright's port knob, not this
script's — it hardcodes 4175 to avoid colliding with a concurrently-running
fast suite) with the `disk` backend pointed at a fresh temp dir
(`BLOB_DISK_ROOT`), `MODEL_PROVIDER=fake`, and `ALLOW_TEST_MODE=1`, then
drives a real HTTP 8-line job with `thai_fake_delay_ms=1000` and
`thai_step_budget_ms=1500` (forcing ≥ 2 steps and ≥ 1 hop) to completion,
deletes its namespace, and stops the server (via its process group, since
`pnpm preview` is a `pnpm` → `sh -c` → `vite` chain and a plain
`child.kill()` would orphan the real server). This is the M1 acceptance
check from PLAN.MD §5.

`scripts/sync-integration.test.ts` (Vitest, not a script you run directly —
it's part of `pnpm test`) is the M1↔M2 acceptance check from PLAN.MD §5:
it drives the real client sync code (`src/sync/**`, `src/db/**`) against
the real handlers listed at the top of this file, in-process, via a request
router in `scripts/testHandlerFetch.ts` that maps `/api/<path>` to the
matching handler's method export and calls it with a real `Request`. See
`.claude/rules/testing.md` for what it covers.
