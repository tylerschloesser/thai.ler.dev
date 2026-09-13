# thai.ler.dev — Implementation Plan (P1: backend, durable jobs, Blob sync)

Planned 2026-09-12 (P0 as-built record: `docs/plans/P0.md`). Execute in one
long-running Opus session that delegates implementation to Sonnet sub-agents
(see §7). Every version number and platform limit below was verified against
npm / official docs on the planning date; re-check with `npm view <pkg>
version` before installing and update this file if it drifted. Research notes
with full citations were produced by six sub-agents; the sources are in §11.

---

## 1. Goal and scope

P0 shipped a working client-only app: paste a dialogue, annotate it line by
line with Claude, everything in IndexedDB, deployed only to SSO-protected
Vercel **preview** URLs because the Anthropic key is inlined into the bundle.

### P1 (this plan) delivers three things

1. **The Anthropic call moves to the backend.** `api/` Vercel Functions hold
   the key; the client bundle contains no key; `src/llm/client.ts`,
   `src/app/anthropic.ts`, the Settings "API key override" and the
   `envPrefix: ['VITE_', 'ANTHROPIC_API_KEY']` line in `vite.config.ts` are
   deleted. Production becomes deployable and **is deployed** (M6).
2. **Annotation survives the client going away.** `POST /api/annotate`
   returns within a second with a job (= the `AnnotationRecord`); the work
   runs server-side in `waitUntil`, persisting to Vercel Blob as it goes;
   if the 300 s Hobby function limit is reached with lines left, the runner
   makes **one continuation hop** to itself; if that hop is refused or fails,
   the remaining lines resume the next time any browser opens the app
   ("resume-on-open", which P0 already had client-side). Closing the tab,
   switching tabs, or opening another browser never loses the job.
3. **The database lives in Vercel Blob; IndexedDB is the local read model.**
   One private Blob per record plus a small manifest; a fresh browser pulls
   the manifest, diffs, fetches changed records, and merges with the
   existing `mergeSnapshot` semantics (LWW by `updatedAt`, tombstones win
   ties). Writes push only the changed record. The app still reads offline.

### Not P1

Summary line, `output_config.effort` knob, IPA, audio/TTS, per-word
questions, spaced repetition (`docs/plans/P0.md` §5b). Anthropic Message
Batches as a "cheap slow mode" (§4.2 explains why it lost; it is a clean
future add-on). Multi-user, concurrent writers, conflict resolution beyond
`mergeSnapshot`. Decommissioning the old AWS stack (Tyler, after DNS).

### Decisions confirmed with Tyler (2026-09-12)

| Question                        | Decision                                                                                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background execution mechanism  | Vercel Function + `waitUntil`, deadline-aware runner, **one** self-continuation hop, resume-on-open as the safety net. Not Queues (public beta, undocumented for plain `api/`), not Workflow DevKit (needs Nitro), not Batches (no per-line progress, minutes to an hour). |
| Plan tier                       | **Stay on Hobby.** Design inside the Hobby Blob quotas (§4.3 budget) and the 300 s function cap. A usage check is part of every milestone gate.                                                                                                                           |
| Auth for production             | **Vercel Authentication "All Deployments"** (free on Hobby since 2026-09-09) plus the one free WAF rate-limit rule on `POST /api/*`. No app-level secret. Internal continuation calls use the Protection Bypass secret plus `INTERNAL_SECRET`.                             |
| Production cutover              | **In P1**, final milestone. Tyler sets the Git production branch to `vercel` in the dashboard (not settable via the documented REST API). From then on a push to `vercel` **is** a production deploy, so the full gate runs before every push. DNS for `thai.ler.dev` is Tyler's step. |
| Blob layout                     | As proposed in the kickoff (per-record blobs + manifest), with two refinements: the store is **private** and every server read uses `useCache: false`; the manifest is written with `ifMatch` and is rebuildable from `list()`.                                            |

### Verified environment facts (2026-09-12)

- Vercel team `tylerschloessers-projects` is on **Hobby**. Project
  `thai-ler-dev` (`prj_mZ6rdu95y6OVvaHsmqpDkibFXKIv`, team
  `team_4mFhw0OaMx19wdVvfq9sEZuX`): framework `vite`, Node `24.x`, Fluid
  compute on, functions region `iad1`, `vercel.json` has only the SPA
  rewrite. Vercel CLI installed here is **59.16.0** (P0 docs say 56.4.1; the
  JSON-envelope parsing in `scripts/e2e-vercel.sh` still applies — re-verify
  the stdout shape in M0).
- The project **is Git-connected** to `tylerschloesser/thai.ler.dev` with
  `link.productionBranch: main`. Verified via `/v6/deployments`: every push
  to `vercel` creates a Git-triggered preview (`source: "git"`), and the CLI
  deploys from P0 show as `source: "cli"`. The only production deployment
  is the project-import build of commit `e2f5747` ("vite init"), so
  `https://thai-ler-dev.vercel.app` currently serves the untouched Vite
  template (HTTP 200, no SSO, bundle contains no key).
- Deployment protection: `ssoProtection.deploymentType =
all_except_custom_domains`. Deployment URLs and Git-branch URLs need SSO;
  the production alias does not (yet).
- Env: `ANTHROPIC_API_KEY` exists in the **preview** environment only. One
  Protection Bypass secret exists on the project (`protectionBypass` has one
  key). **This checkout has neither `.vercel/` nor `.env.local`** — the
  executor must `vercel link` and Tyler must re-create `.env.local` (§8).
- **No Blob store exists** (`vercel blob list-stores` → none).
- Local Node is **22.23.2** (Vercel runs 24.x). Node ≥ 22.18 strips
  TypeScript types natively, but extensionless relative imports are not
  resolved by Node — the local API loader uses `tsx` (§4.7).
- `thai.ler.dev` DNS still points at the old AWS deployment.

### Findings that shaped the plan

- **Hobby functions: 300 s is both the default and the maximum
  `maxDuration`** with Fluid compute, and `waitUntil` work shares that clock
  (measured from invocation start; `getDeadline()` exposes it). Overrun
  kills the work silently after the response was already sent. There is no
  extended tier on Hobby.
- **Client disconnect does not cancel a function** unless
  `supportsCancellation: true` is set for that path in `vercel.json`. We
  never set it for `api/**`.
- **Self-invocation is legal but undocumented**; Vercel's recursion
  protection propagates `x-vercel-id` on outbound `fetch` and returns HTTP
  508 `INFINITE_LOOP_DETECTED` after an unpublished number of hops
  (community reports show six segments in the id). Hence: at most **one hop
  per step and at most 3 hops per lineage** (`MAX_HOPS = 3`); a browser-
  originated resume starts a fresh lineage.
- **Hobby Blob quotas are tiny**: 1 GB storage, **2,000 advanced ops**
  (`put`, `copy`, `list`), **10,000 simple ops** (uncached `get`, `head`)
  per month; exceeding them suspends the store until the 30-day window
  rolls. Per-line record writes and 1-second polling would blow this in a
  week. §4.3 fixes a budget: ≤ 12 advanced ops per job, one 4-second poll
  per running job, one manifest read per app load. `del` is free.
- **Private Blob + `get(..., { useCache: false })` is documented as
  read-after-write consistent**; the public CDN path can serve a stale
  overwrite for up to 60 s. All reads go through functions, so the store is
  private and every read is uncached. `put(..., { ifMatch: etag })` gives
  optimistic concurrency for the manifest.
- **Vercel Authentication "All Deployments" became free on every plan on
  2026-09-09** (changelog; the docs page and pricing page still say
  Pro-only). It gates `/api/*` at the edge; same-origin `fetch` from the
  protected page carries the SSO cookie automatically; the automation
  bypass header keeps working for Playwright and for the hop.
- The `@anthropic-ai/sdk` non-streaming path is allowed for
  `max_tokens: 16000` (the "streaming required" threshold is > 21,333
  tokens), but `messages.stream()` + `finalMessage()` is kept server-side:
  same code as today, and it avoids idle-connection drops. Stripping
  `.parse` from `zodOutputFormat()` remains necessary (`messages.parse()`
  has the same eager-throw problem).
- Prompt caching: "a cache entry only becomes available after the first
  response begins" — so the runner **warms** the cache with one line before
  fanning out. Minimum cacheable prefix is 512 tokens on Opus 5, 1,024 on
  Sonnet 5; the system prompt alone exceeds both.
- Vercel Queues (public beta, `queue/v2beta` trigger, Next-only examples,
  Hobby quota unstated), Workflow DevKit (GA, but the Vite guide requires
  Nitro owning `api/`), Cron on Hobby (once per day, ±59 min) and Anthropic
  Batches (poll-only, results land all at once, typically < 1 h) were
  evaluated and rejected as the primary mechanism; details in §4.2.

---

## 2. Stack deltas (versions verified 2026-09-12)

Everything from `docs/plans/P0.md` §2 stays. Additions and changes:

| Area                | Choice                        | Version                | Notes                                                                                                                                                                                                                                                                                                              |
| ------------------- | ----------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Functions           | Vercel Functions, Node 24     | platform               | Web-standard handlers `export function GET/POST(request: Request)`. Files under `api/`; `api/_lib/**` is ignored by the router (leading `_`). Only `api/**/*.ts` glob in `vercel.json` `functions` with `maxDuration: 300`. No dynamic `[id]` segments (source-only support today) — ids travel as query params. |
| Post-response work  | `@vercel/functions`           | **3.9.7**              | `waitUntil(promise)`, `getDeadline()`. Both are silent no-ops / unavailable outside Vercel; the runner falls back to `STEP_BUDGET_MS`.                                                                                                                                                                              |
| Storage             | `@vercel/blob`                | **2.8.0**              | Server SDK only. `put` (`allowOverwrite`, `ifMatch`), `get` (`useCache: false`), `list`, `del`, `head`. Private stores GA since 2026-06-30. `addRandomSuffix` defaults to `false`.                                                                                                                                  |
| LLM SDK             | `@anthropic-ai/sdk`           | 0.125.0 (installed)    | Latest is still 0.125.0. Node client without `dangerouslyAllowBrowser`; explicit `timeout: 90_000, maxRetries: 1`.                                                                                                                                                                                                 |
| Local API loader    | `tsx`                         | 4.23.13 (installed)    | `tsImport` from `tsx/esm/api` loads `api/*.ts` inside `vite preview` (Node 22 cannot resolve extensionless imports natively). `vite dev` uses `server.ssrLoadModule`.                                                                                                                                              |
| Node ↔ web adapter  | `@remix-run/node-fetch-server` | **0.14.1**             | `createRequestListener(handler)`: zero-dependency adapter from `(req, res)` to `Request → Response` for the Vite middleware plugin. Alternatives (`@hono/node-server` 2.1.1, `srvx` 1.0.4) work too; pick this for size.                                                                                            |
| Vercel CLI          | `vercel`                      | **59.16.0** (installed) | `vercel blob create-store/list/put/get/del/empty-store`, `vercel env add/pull`, `vercel link`, `vercel deploy --yes`.                                                                                                                                                                                              |
| Not adopted         | `vite-plugin-vercel` 11.1.1   | —                      | Switches deploys to the Build Output API, single maintainer, unverified dev serving of `api/`. Zero benefit for this repo.                                                                                                                                                                                          |
| Not adopted         | `workflow` 4.8.8, `@vercel/queue` 0.5.1 | —              | See §1 findings and §4.2. `annotateLine`/the runner stay transport-agnostic so Queues can replace the hop later if it goes GA on Hobby.                                                                                                                                                                             |
| TypeScript          | `typescript`                  | ~6.0.2 (installed)     | Latest is 7.0.2; do not upgrade in P1. New `tsconfig.api.json` (`api/`, `src/llm`, `src/lib`; `types: ["node"]`) referenced from the root `tsconfig.json` so `tsc -b` typechecks functions.                                                                                                                       |

---

## 3. Repository layout (target; additions to P0 §3 marked `+`)

```
.
├── CLAUDE.md                     # updated hard rules (§6.1)
├── PLAN.MD                       # this file (executor updates status markers)
├── docs/plans/P0.md              # as-built P0 record (verbatim)
├── vercel.json                   # + functions maxDuration, rewrite excludes /api
├── tsconfig.api.json             # + typecheck for api/ + shared src/llm, src/lib
├── api/                          # + Vercel Functions (web-standard handlers)
│   ├── health.ts                 #   GET  /api/health
│   ├── annotate.ts               #   POST /api/annotate
│   ├── annotation.ts             #   GET  /api/annotation?id=
│   ├── annotation/               #   POST /api/annotation/{resume,cancel,step}?id=
│   │   ├── resume.ts  cancel.ts  step.ts
│   ├── sync/
│   │   ├── manifest.ts           #   GET  /api/sync/manifest ; POST /api/sync/manifest/rebuild
│   │   ├── manifest/rebuild.ts
│   │   └── record.ts             #   GET  /api/sync/record?kind=&id= ; PUT /api/sync/record
│   ├── test/
│   │   ├── seed.ts               #   POST   /api/test/seed        (ALLOW_TEST_MODE only)
│   │   └── namespace.ts          #   DELETE /api/test/namespace?ns= (ALLOW_TEST_MODE only)
│   └── _lib/                     #   not routed
│       ├── http.ts               #   json(), fail(), readJson(), no-store headers
│       ├── context.ts            #   env + test-mode cookies → { store, provider, budget }
│       ├── env.ts                #   typed env access, defaults
│       ├── store/                #   BlobStore interface + memory | disk | vercel
│       │   ├── index.ts  memory.ts  disk.ts  vercel.ts  paths.ts
│       ├── records.ts            #   getRecord/putRecord/manifest (LWW, ifMatch)
│       ├── runner.ts             #   runStep(): deadline, lease, warm-up, flush, hop
│       ├── hop.ts                #   self-continuation fetch
│       └── providers/
│           ├── index.ts          #   select by env + test cookie
│           ├── anthropic.ts      #   Node client + annotateLine
│           └── fake.ts           #   fixture-backed; fake-slow; error injection
├── scripts/
│   ├── vite-api-plugin.ts        # + serves api/ in vite dev + vite preview
│   ├── load-env.ts               # + shared .env.* reader (used by plugin + playwright)
│   ├── e2e-vercel.sh             #   changed: runs only @live specs
│   └── gen-fixture.ts            #   changed: uses the anthropic provider + memory store
├── e2e/
│   ├── fixtures.ts               #   changed: namespace cookie, test-mode cookies, guard
│   ├── mocks/anthropic.ts        #   SSE builder kept for Vitest; route handler removed
│   ├── *.spec.ts                 #   fast suite (local, memory store, fake provider)
│   └── live/*.spec.ts            # + @live suite (preview deployment, real Blob)
└── src/
    ├── lib/records.ts            # + shared record types (no Dexie import), Manifest types
    ├── llm/                      #   client.ts deleted; + provider.ts; annotateLine gets onStart
    ├── sync/                     # + client sync: api.ts pull.ts push.ts poll.ts useSync.ts
    ├── db/                       #   Dexie v2: annotations.run, outbox table; snapshot v2
    ├── app/                      #   anthropic.ts deleted; debug.ts exposes sync helpers
    └── features/                 #   useAnnotate → job client; Settings → sync status
```

`.gitignore` additions: `.data/` (local disk Blob backend).

---

## 4. Architecture

### 4.1 API surface

All handlers: web-standard, named method exports, JSON in/out, every
response carries `Cache-Control: private, no-store`. Errors are
`{ error: { kind, message } }` with `kind ∈ bad_request | not_found |
unauthorized | busy | provider | store | internal` and the matching HTTP
status (400/404/401/409/502/502/500). Request bodies are validated with zod
(`readJson(request, schema)`); a failed parse is `bad_request`.

| Route                                 | Body / query                                              | Response                                        | Notes                                                                                                                                            |
| ------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`                     | —                                                         | `{ ok, provider, blobBackend, testMode, sha }`  | `sha` = `VERCEL_GIT_COMMIT_SHA ?? 'local'`. Never reveals secrets.                                                                                |
| `POST /api/annotate`                  | `{ dialogue: Dialogue, model }`                           | `202 { dialogue, annotation }`                  | Upserts the dialogue (LWW), creates the `AnnotationRecord` (`run.state: 'queued'`), sets `dialogue.currentAnnotationId`, writes both + manifest, then `waitUntil(runStep(...))`. |
| `GET /api/annotation?id=`             | `id`                                                      | `200 AnnotationRecord`                          | Fresh read (`useCache: false`). Polled by the client every 4 s while the run is active.                                                          |
| `POST /api/annotation/resume?id=`     | `id`                                                      | `202 AnnotationRecord` or `409 busy`            | Starts a step only if the lease is expired or absent and lines remain. New lineage (`run.hops = 0`).                                             |
| `POST /api/annotation/cancel?id=`     | `id`                                                      | `200 AnnotationRecord`                          | Sets `run.state: 'cancelled'`; the runner checks between lines and stops (already-started calls finish and are persisted).                       |
| `POST /api/annotation/step?id=`       | `id`; header `x-thai-internal: $INTERNAL_SECRET`          | `202 {}` or `401`                               | Internal continuation. Also requires the bypass header on Vercel (edge-enforced). Increments `run.hops`; refuses (`409`) when `hops >= MAX_HOPS`. |
| `GET /api/sync/manifest`              | —                                                         | `200 Manifest`                                  | One uncached read.                                                                                                                               |
| `GET /api/sync/record?kind=&id=`      | `kind ∈ dialogue \| annotation \| settings`               | `200 { kind, record }`                          | For `settings`, `id` is `all` and `record` is `SettingRow[]`.                                                                                    |
| `PUT /api/sync/record`                | `{ kind, record }`                                        | `200 { kind, record: winner }`                  | Server-side LWW against the stored copy (`pickWinner` semantics from `src/db/snapshot.ts`, extracted to `src/lib/merge.ts`). Returns the winner. |
| `POST /api/sync/manifest/rebuild`     | —                                                         | `200 Manifest`                                  | `list()` every record blob, read each, rewrite the manifest. Maintenance; wired to a Settings button.                                            |
| `POST /api/test/seed`                 | `{ dialogues, annotations, settings }` (Snapshot subset)  | `200 { counts }`                                | `ALLOW_TEST_MODE=1` only, else 404.                                                                                                              |
| `DELETE /api/test/namespace?ns=`      | `ns`                                                      | `200 { deleted }`                               | `ALLOW_TEST_MODE=1` only. `list({ prefix })` pages → `del(urls)`.                                                                                |

Request context (`api/_lib/context.ts`) resolves per request:
`store` (backend + prefix), `provider`, `stepBudgetMs`, `testMode`. When
`ALLOW_TEST_MODE=1`, these cookies are honoured; otherwise they are ignored
entirely:

| Cookie                | Values                                    | Effect                                                                                     |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `thai_ns`             | `^[a-z0-9-]{1,64}$`                       | Store prefix becomes `ns/<value>/v1/…` instead of `v1/…`. Isolates every e2e test.         |
| `thai_model`          | `fake` \| `fake-slow`                     | Provider override (fake-slow = 300 ms per line). Stored on `run.provider` so hops keep it. |
| `thai_fake_error`     | an `AnnotateErrorKind`, e.g. `rate_limited` | Fake provider fails every line with that kind while set. Replaces P0's `mockAnthropicError`. |
| `thai_step_budget_ms` | integer                                   | Caps the runner's per-step budget (forces hops in tests).                                  |
| `thai_fake_delay_ms`  | integer 0–60 000                          | Overrides the fake provider's per-line delay (added in M1, see §10 "Corrected during M1/M2"). |

### 4.2 Job execution

**Why this mechanism** (decision table; all mechanisms were researched with
sources in §11):

| Mechanism                          | Hobby | Survives tab close | Job length              | Complexity | Why it lost / won                                                                                        |
| ---------------------------------- | ----- | ------------------ | ----------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| `waitUntil` + one hop + resume     | yes   | yes                | ≤ ~300 s per step, chained ≤ 3 hops, then resume-on-open | low   | **Won.** No beta APIs, testable in-process, reuses P0's pipeline and resume semantics.                     |
| Vercel Queues (`@vercel/queue` 0.5.1) | beta, quota unstated | yes | unbounded (≤ 300 s per message) | medium | Right primitive, wrong maturity: `queue/v2beta` trigger, Next-only examples, plain-`api/` consumer undocumented. |
| Workflow DevKit (`workflow` 4.8.8) | yes   | yes                | unlimited (300 s/step)  | high       | GA, but the Vite integration requires Nitro to own `api/`; heavy lock-in for a personal app.             |
| Anthropic Message Batches          | n/a   | yes                | ≤ 24 h                  | low        | 50 % cheaper, but no per-line results and no webhook; minutes-to-an-hour latency for the happy path. Future "cheap mode". |
| Cron sweeper                       | yes   | —                  | once per day ±59 min    | —          | Useless as a stuck-job sweeper on Hobby.                                                                 |

**Runner** (`api/_lib/runner.ts`, `runStep(ctx, annotationId)`), invoked
inside `waitUntil` by `annotate`, `resume` and `step`:

1. Load the record fresh. Stop if `run.state ∈ done | cancelled`, or if
   `run.leaseUntil > now + 5 s` (another runner is alive).
2. Take the lease: `run.state = 'running'`, `run.leaseUntil = now +
   budget + 30 s`, `run.steps += 1`; write the record (1 advanced op).
   `budget = min(getDeadline() - now - 20 s, STEP_BUDGET_MS, cookie cap)`;
   outside Vercel `getDeadline()` is unavailable and `STEP_BUDGET_MS`
   (default 250 000) applies.
3. `pending = indexes where lines[i] === null`. If no line has succeeded yet
   and `pending.length > 1`, run the first pending line alone until the
   provider signals `onStart` (first stream event → both cache breakpoints
   are being written), then fan out the rest with `CONCURRENCY = 6`.
4. Deadline loop: never start a line when `remaining < LINE_RESERVE_MS`
   (70 000). Each finished line updates the in-memory record; flush (write
   the record blob, refresh `leaseUntil`) when the last flush is > 25 s old,
   on every line error, and at the end. A 20-line job therefore costs ~6–8
   record writes, not 20.
5. At the end: if lines remain and `run.state` is still `running`: if
   `run.hops < MAX_HOPS` (3) and `VERCEL_URL` is set, call
   `hop(annotationId)` (§10 snippet) and, on any non-2xx or thrown error,
   leave the record `running` with `leaseUntil = now` (visibly stalled);
   otherwise the same. If no lines remain: `run.state = 'done'`,
   `status = complete | partial`, `usage`/`durationMs` accumulated, record
   write, manifest entry update (`ifMatch`). `run.lastError` records a
   step-level failure (store or provider construction), never per-line
   errors (those stay in `lineErrors`).

**Client's part** (`src/sync/poll.ts` + `useAnnotate`): while
`run.state ∈ queued | running`, poll `GET /api/annotation` every 4 s and
merge. If `run.leaseUntil < now - 15 s` and lines remain, `POST
/api/annotation/resume` (at most once per minute per record). That is
resume-on-open: nothing else is needed for "come back later on another
browser" — the record is in Blob, the manifest lists it, the pull finds it,
the poller notices it is stalled, and the resume finishes it. "Retry failed
lines" and "resume" are the same operation as in P0 (`resume` re-runs every
`null` line).

**Provider interface** (`src/llm/provider.ts`):

```ts
export interface LineProvider {
  readonly name: 'anthropic' | 'fake' | 'fake-slow'
  annotate(opts: {
    model: string
    lines: SplitLine[]
    lineIndex: number
    signal?: AbortSignal
    onStart?: () => void // first response event (cache warm-up gate)
  }): Promise<AnnotateLineResult>
}
```

`annotateLine.ts` gains `onStart` (`stream.once('streamEvent', onStart)`)
and otherwise stays as in P0, including the `.parse`-stripping. The Anthropic
provider builds `new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 })`
once per invocation (worst case ≈ 181 s < 300 s). The fake provider returns
`src/fixtures/sample.annotation.json` lines matched by Thai text (as the P0
route handler did), sleeps 300 ms in `fake-slow`, and honours
`thai_fake_error`. Never `thinking`, never `temperature` (hard rule 7).

**Latency envelope** (estimate, to be measured in M4): fixture lines are
1.9–4.6 KB of JSON (≈ 1–2.5 K output tokens); Opus 5 lines take roughly
20–60 s. With warm-up + 6-wide fan-out, 8 lines ≈ 60–120 s, 20 lines ≈
150–250 s — usually one step. Long pastes hop once or twice.

**Measured in M4** (`live/real-model`, preview `thai-ler-ko3z03nvw`,
2026-09-13): a 2-line dialogue on `claude-sonnet-5` took **≈ 112 s** end to
end. The warm-up line runs alone until its first stream event, and then the
second joins it. Usage was 176 input, **12 761 output** (≈ 6.4 K per line,
thinking included) and 3 408 cache-read tokens, about $0.20. So output per
line is roughly 3× the estimate above, and a line takes about 1–2 minutes,
not 20–60 s. A 20-line paste therefore needs several 300 s steps, meaning
hops and possibly a resume-on-open after `MAX_HOPS`. That is exactly the
path the runner was built for. Opus 5 was not measured (the smoke uses
Sonnet by design).

### 4.3 Blob layout, store abstraction, budget

**Store**: one private store per environment pair —
`thai-ler-dev-preview` (connected to `preview` + `development`, created in
M0) and `thai-ler-dev-prod` (`production`, created in M6). Region `iad1`.
Access mode and region cannot be changed after creation.

**Paths** (`api/_lib/store/paths.ts`; `<prefix>` is `v1/` or
`ns/<thai_ns>/v1/` in test mode):

```
<prefix>manifest.json
<prefix>dialogues/<id>.json
<prefix>annotations/<id>.json
<prefix>settings.json            # SettingRow[]
```

```ts
interface Manifest {
  format: 'thai.ler.dev/manifest'
  version: 1
  updatedAt: string
  entries: Record<string, ManifestEntry> // key `${kind}:${id}`; settings key 'settings:all'
}
interface ManifestEntry {
  kind: 'dialogue' | 'annotation' | 'settings'
  id: string
  updatedAt: string
  deletedAt: string | null
}
```

**BlobStore interface** (`api/_lib/store/index.ts`), three backends
selected by `BLOB_BACKEND = memory | disk | vercel`:

```ts
export interface BlobStore {
  getJson<T>(path: string): Promise<{ value: T; etag: string } | null>
  putJson(path: string, value: unknown, opts?: { ifMatch?: string }): Promise<{ etag: string }>
  list(prefix: string): Promise<Array<{ pathname: string; url: string }>> // all pages
  del(urls: string[]): Promise<void>
}
```

`vercel.ts` maps to `get(path, { access: 'private', useCache: false })`,
`put(path, JSON, { access: 'private', allowOverwrite: true, contentType:
'application/json', addRandomSuffix: false, ifMatch })`, `list({ prefix,
cursor })` until `hasMore === false`, `del(urls)`. `memory.ts` is a `Map`
(Playwright fast suite, Vitest); `disk.ts` writes under `.data/blob/`
(`pnpm dev` persistence across restarts). All three implement `ifMatch`
(`BlobPreconditionFailedError` → `StorePreconditionError`).

**Manifest updates** (`api/_lib/records.ts`): `putRecord(kind, record)` =
put the record blob, then `get` manifest (uncached) → set entry → `put`
with `ifMatch: etag`; on precondition failure re-read and retry once, then
fail with `store`. The runner's intermediate flushes write **only the record
blob**; the manifest entry is written at job creation and job end.
`rebuildManifest()` lists `<prefix>dialogues/`, `<prefix>annotations/`,
`<prefix>settings.json`, reads each, and rewrites the manifest.

**Consistency**: every server read is `useCache: false` on a private store
(documented read-after-write). Nothing in the browser ever sees a Blob URL.
Single writer per environment is an assumption, not enforced; `ifMatch` on
the manifest catches the accidental double-writer.

**Hobby budget** (ops counted from the pricing docs: `put`/`list` =
advanced; uncached `get`/`head` = simple; `del` = free):

| Action                                     | Advanced ops | Simple ops             |
| ------------------------------------------ | ------------ | ---------------------- |
| One annotation job (20 lines)              | 1 dialogue put + ~7 record puts + 2 manifest puts ≈ **10** | 2 manifest reads + ~1 record read |
| Client watching a job (4 s poll, 4 min)    | 0            | ≈ 60                   |
| App load / tab focus (pull)                | 0            | 1 manifest + N changed records |
| Client write (rename, delete, settings)    | 2            | 1                      |
| Live e2e run (`@live`, 5 specs)            | ≈ 40         | ≈ 80                   |

At ~3 jobs/day plus daily use this is ≈ 1,200 advanced / 6,000 simple per
month: inside the 2,000 / 10,000 allowance with headroom, provided the live
suite runs only at milestone ends. `GET /api/health` touches no Blob. The
executor records the dashboard's Blob usage after every `@live` run (§7).

### 4.4 Data model changes (client, `src/db`)

Shared record types move to `src/lib/records.ts` (pure types, no Dexie) and
are re-exported from `src/db/db.ts` so nothing else changes its imports.
`api/` imports only from `src/lib` and `src/llm`, never from `src/db`.

`AnnotationRecord` gains `run`; `status` keeps its P0 meaning
(`complete` iff every line is non-null):

```ts
export interface AnnotationRun {
  state: 'queued' | 'running' | 'done' | 'cancelled'
  provider: 'anthropic' | 'fake' | 'fake-slow'
  leaseUntil: string | null
  hops: number
  steps: number
  lastError: string | null
}
export const RUN_STATES = ['queued', 'running', 'done', 'cancelled'] as const
```

UI derivation (`src/features/annotate/useAnnotate.ts`): `running` = state
queued/running and lease in the future; `stalled` = state running/queued,
lease expired, lines remain; `failed` = state done, status partial;
`cancelled`; `complete`.

Dexie **version 2** (`src/db/db.ts`), with `.upgrade()`:

- `annotations`: existing rows get `run = { state: 'done', provider:
'anthropic', leaseUntil: null, hops: 0, steps: 0, lastError: null }`.
- new table `outbox: key` with rows `{ key: '<kind>:<id>', kind, id,
updatedAt }` (settings key `settings:all`).
- `meta` gains `lastPullAt` and `syncInitialized` keys.
- `DB_SCHEMA_VERSION = 2`; snapshots export `schemaVersion: 2`;
  `importSnapshot` accepts `1` by applying the same defaulting
  (`upgradeSnapshot`), and still refuses anything else with the readable
  error.

`repo.ts` additions (still the only write path): `enqueueOutbox` (called
inside the same transaction by `createDialogue`, `renameDialogue`,
`softDeleteDialogue`, `setCurrentAnnotation`, `setSetting` via a small hook
in `settings.ts`, and `importSnapshot`), `takeOutbox`/`clearOutbox`,
`mergeRemoteDialogue`, `mergeRemoteAnnotation`, `mergeRemoteSettings` (LWW
via `pickWinner`, extracted to `src/lib/merge.ts` and shared with the
server). `createAnnotation`/`upsertAnnotationLine`/`finalizeAnnotation`
become server-only concepts and are deleted from `repo.ts` (their unit
tests move to `api/_lib/records.test.ts`).

### 4.5 Client changes

- **`src/sync/`** (new): `api.ts` (typed `fetch` wrappers with the error
  shape), `pull.ts` (manifest → diff by `updatedAt` → fetch → merge;
  writes `meta.lastPullAt`), `push.ts` (drain the outbox, PUT each, merge
  the returned winner, delete the row; a failed PUT stays queued), `poll.ts`
  (per-annotation poller + stalled-resume), `useSync.ts` (status for the
  UI: `lastPullAt`, `pendingPushes`, `lastError`, `syncNow()`), `index.ts`
  (`startSync()` from `main.tsx`: pull → push on load, pull on
  `visibilitychange` → visible and on `online`, push debounced 500 ms after
  any outbox write via a Dexie `creating` hook on `outbox`). First run after
  the upgrade (`meta.syncInitialized` absent): enqueue every local
  dialogue/annotation/settings row, then push — this is how Tyler's existing
  library migrates.
- **`useAnnotate`**: `start(sourceText)` → `POST /api/annotate` → merge
  both records → poller; `retry()` → `POST resume`; `cancel()` → `POST
cancel`. The in-tab `activeRuns` registry and `AbortController` go away.
  `startAnnotation` (called by `Composer` and `DialogueView`) keeps its
  signature. Offline `POST` → toast "Annotation needs a connection" (no
  offline job queue in P1).
- **Settings**: remove the API-key field, `apiKeyOverride` setting and the
  "no API key configured" `EmptyState`; add a Sync section (last pull,
  pending pushes, "Sync now", "Rebuild sync index"). `model` stays and is
  sent with `POST /api/annotate`.
- **Deleted**: `src/llm/client.ts` (+ test), `src/app/anthropic.ts`,
  `src/llm/pipeline.ts` (its queue/resume logic moves to
  `api/_lib/runner.ts`; `scripts/gen-fixture.ts` uses the runner with the
  memory store and the anthropic provider), `envPrefix` in
  `vite.config.ts`.
- **`window.__thai`** gains `sync: { pull, push, pollNow, status }` for
  e2e speed (`.claude/rules/testing.md` keeps `db`, `importSnapshot`,
  `exportSnapshot`).

### 4.6 Auth and secrets

- Production and previews: **Vercel Authentication, "All Deployments"**
  (`ssoProtection.deploymentType: "all"`; dashboard: Settings → Deployment
  Protection). The browser logs in at vercel.com once per origin; `/api/*`
  is gated at the edge; same-origin `fetch` carries the cookie. Playwright
  and `scripts/e2e-vercel.sh` keep using `x-vercel-protection-bypass` +
  `x-vercel-set-bypass-cookie` (works on all deployments in a project).
- **WAF**: one rate-limit rule (Hobby includes one): path starts with
  `/api/`, method `POST`, 60 requests / 60 s per IP, action deny. Dashboard
  step for Tyler (M6).
- **Hop authentication**: the runner sends `x-vercel-protection-bypass:
$VERCEL_AUTOMATION_BYPASS_SECRET` (auto-injected system env var on every
  deployment once a bypass secret exists) and `x-thai-internal:
$INTERNAL_SECRET` (a 32-byte hex secret the executor adds to
  `production`, `preview`, `development` with `vercel env add`). `step.ts`
  compares with `crypto.timingSafeEqual` and answers 401 otherwise. Locally
  `INTERNAL_SECRET` defaults to `local-dev`.
- **Secrets never in the client**: `vite.config.ts` has no `envPrefix`
  (default `VITE_` only); a Vitest test asserts the built bundle contains
  neither `sk-ant-` nor `vercel_blob_rw_` (`scripts/check-bundle.test.ts`
  runs on `dist/` — part of `pnpm test:e2e`'s build, M3).
- `ANTHROPIC_API_KEY` moves to a **sensitive** env var (runtime-only) in
  `production` and `preview`; the existing plain preview var is replaced.
- Test mode (`ALLOW_TEST_MODE=1`) exists in `preview` and `development`,
  **never** in `production`; `api/_lib/env.ts` refuses to start with
  `ALLOW_TEST_MODE=1` when `VERCEL_ENV === 'production'`.

### 4.7 Local development

- `pnpm dev`: Vite dev server + `scripts/vite-api-plugin.ts`
  (`configureServer`): requests to `/api/*` resolve to `api/<path>.ts`
  (rejecting `_`-prefixed segments), load the module with
  `server.ssrLoadModule` (HMR for handlers), pick the export matching the
  method, and adapt via `createRequestListener`. Env: `scripts/load-env.ts`
  reads `.env.development.local` then `.env.local` (never overriding the
  shell, never logging values). Defaults: `BLOB_BACKEND=disk`
  (`.data/blob/`), `MODEL_PROVIDER=anthropic` when `ANTHROPIC_API_KEY` is
  set else `fake` (console warning), `ALLOW_TEST_MODE=1`,
  `STEP_BUDGET_MS=250000`. `waitUntil` is a no-op outside Vercel, so the
  promise simply keeps running in the dev process — the same code path.
- `pnpm preview` (and Playwright's `webServer`): the same plugin via
  `configurePreviewServer`, loading handlers with `tsImport` from
  `tsx/esm/api` (Node 22 cannot resolve extensionless TS imports natively).
- Real Blob from a local process: `vercel env pull .env.development.local
--environment=development` (a **different file** from `.env.local`, which
  `vercel env pull` would otherwise clobber without the bypass secret) then
  `BLOB_BACKEND=vercel pnpm dev`. Optional; the disk backend is the default.
- `vercel dev` is **not** used: it needs a link + login, adds per-request
  proxy latency with Vite, and brings nothing the plugin lacks.

### 4.8 Testing

**Vitest** (`pnpm test`): everything from P0 that survives, plus
`api/_lib/**/*.test.ts` (store backends incl. `ifMatch`, records/manifest
LWW and rebuild, runner with the fake provider and a fake clock — warm-up
gate, deadline stop, flush cadence, hop decision, cancel, lease — handlers
called as `await POST(new Request(...))`, context cookie parsing, env
guard), `src/sync/**/*.test.ts` (pull/push/poll against a stubbed `fetch`
and `fake-indexeddb`), `src/lib/merge.test.ts`, snapshot v1→v2 upgrade.
`e2e/mocks/anthropic.ts` keeps `sseFromText` for the SDK round-trip test.
Vitest runs `environment: 'node'` already, so web `Request`/`Response` work
as-is. `vitest.config.ts` `include` adds `api/**/*.test.ts`.

**Playwright fast suite** (`pnpm test:e2e`, target < 60 s, currently 19
specs in ~7 s): `webServer` = `pnpm build && pnpm preview --port 4173
--strictPort` with `env: { BLOB_BACKEND: 'memory', MODEL_PROVIDER: 'fake',
ALLOW_TEST_MODE: '1', STEP_BUDGET_MS: '250000' }`. `e2e/fixtures.ts`:

- `context` override adds cookies `thai_ns=e2e-<testId-hash>` and
  `thai_model=fake` for `baseURL` before any navigation; teardown calls
  `DELETE /api/test/namespace?ns=` through the `request` fixture.
- `seed(snapshot)` keeps working (IndexedDB import → outbox → push); a new
  `seedServer(snapshot)` posts to `/api/test/seed` for server-owned state
  (stalled jobs, records that exist only remotely).
- `fakeError(kind)` sets/clears `thai_fake_error` (replaces
  `mockAnthropicError`).
- The `api.anthropic.com` route becomes a **guard**: any browser request to
  it throws and fails the test (hard rule 2).

Specs (renamed/added; the P0 list is in `docs/plans/P0.md` §4.6):

| Spec                     | Covers                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke`, `theme`, `deep-link`, `word-popover`, `library` | unchanged behaviour; `library` additionally asserts the rename/delete reach the server (`GET /api/sync/record`).                        |
| `annotate`               | paste sample → Annotate → `/d/:id` → lines render as the poller merges them → status complete; `GET /api/annotation` shows `run.state: 'done'`.          |
| `persistence`            | annotate → reload → still there (IndexedDB) **and** a brand-new context with the same namespace pulls it (Blob).                                         |
| `errors`                 | `fakeError('rate_limited')` → lines fail with the readable message + toast → clear → Retry failed → complete.                                            |
| `settings`               | model change persists and is sent to `/api/annotate`; export/import; Sync section shows last pull; no API-key field exists.                              |
| `sync`                   | context A creates + renames; context B (same namespace) loads and sees both; B deletes; A regains focus → dialogue gone. Export from B equals A's.        |
| `job-survives-tab`       | `fake-slow` + start → close the page immediately → new context polls `GET /api/annotation` until `done` (no browser was open while it finished).        |
| `job-hop`                | `fake-slow` + `thai_step_budget_ms=1500` → job needs ≥ 2 steps → completes; record shows `steps ≥ 2`, `hops ≥ 1`.                                        |
| `job-resume-on-open`     | `seedServer` a `running` record with an expired lease and 3 null lines → open `/d/:id` → client resumes → complete; `steps` incremented.                 |
| `job-cancel`             | `fake-slow` → Cancel → `run.state: 'cancelled'`, partial lines kept, Retry works.                                                                         |
| `api-health`             | `GET /api/health` shape; unknown `/api/nope` is 404, not `index.html`.                                                                                   |

**Playwright live suite** (`pnpm test:e2e:vercel` → deploy a CLI preview →
`playwright test --grep @live`), against the real Vercel runtime and the
preview Blob store, fake provider by default, each test in its own
namespace with teardown:

| Spec                     | Covers                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `live/health`            | 200 + `testMode: true`, `blobBackend: 'vercel'`; the SPA rewrite still serves `/settings`.                                                   |
| `live/annotate`          | fake provider, real `waitUntil` + real Blob; a fresh context sees `done`.                                                                    |
| `live/hop`               | `fake-slow` + `thai_step_budget_ms=3000` → ≥ 2 hops on Vercel — proves the bypass header + `INTERNAL_SECRET` path and that 3 hops don't 508. |
| `live/sync`              | two contexts, same namespace: create in A, pull in B.                                                                                        |
| `live/real-model`        | **skipped unless `E2E_REAL_MODEL=1`**: 2-line dialogue with `claude-sonnet-5` and the real provider (cookie `thai_model` unset) → both lines schema-valid. ≈ $0.05. Run once per milestone that touches `src/llm` or `api/_lib/providers`. |

Against **production** (test mode off) only `live/health` is meaningful;
run it after the cutover with `PLAYWRIGHT_BASE_URL=https://thai-ler-dev.vercel.app`.

### 4.9 Deploy and environments

| Variable                          | production                | preview                   | development (local)                    | Purpose                                                    |
| --------------------------------- | ------------------------- | ------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| `ANTHROPIC_API_KEY`               | sensitive (M6)            | sensitive (replace in M0) | shell export                           | Node client                                                |
| `BLOB_READ_WRITE_TOKEN`           | auto (prod store, M6)     | auto (preview store, M0)  | only via `vercel env pull .env.development.local` | `@vercel/blob`                                  |
| `INTERNAL_SECRET`                 | M6                        | M0                        | defaults to `local-dev`                | hop auth                                                   |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | auto                      | auto                      | n/a                                    | hop passes deployment protection                           |
| `ALLOW_TEST_MODE`                 | **never**                 | `1`                       | `1` (plugin default)                   | honour test cookies, enable `/api/test/*`                  |
| `MODEL_PROVIDER`                  | `anthropic`               | `anthropic`               | `anthropic` if key else `fake`         | default provider                                           |
| `BLOB_BACKEND`                    | `vercel`                  | `vercel`                  | `disk` (Playwright: `memory`)          | store backend                                              |
| `STEP_BUDGET_MS`                  | unset (deadline-derived)  | unset                     | `250000`                               | runner budget when `getDeadline()` is unavailable          |

`vercel.json` (§10) sets `functions: { "api/**/*.ts": { "maxDuration": 300 } }`
and the rewrite `"/((?!api/).*)" → /index.html` (functions win over
rewrites anyway; the exclusion makes unknown `/api/*` a 404).

Per-milestone flow, **before** the cutover: `pnpm check && pnpm test && pnpm
test:e2e` → commit → `pnpm test:e2e:vercel` (CLI preview + `@live`) → `git
push origin vercel` (creates a Git preview; harmless). **After** the cutover
(M6): identical, but the push is the production deploy, so the CLI-preview
live run must be green first, and `live/health` runs against
`https://thai-ler-dev.vercel.app` after the push.

### 4.10 Production cutover (M6)

1. Executor: `vercel blob create-store thai-ler-dev-prod --access private
--region iad1 --environment production`; `printf '%s' "$ANTHROPIC_API_KEY"
| vercel env add ANTHROPIC_API_KEY production --sensitive`; add
   `INTERNAL_SECRET production`. Verify with `vercel env ls` that
   `production` has **no** `ALLOW_TEST_MODE`.
2. Tyler (dashboard): Deployment Protection → Vercel Authentication → **All
   Deployments**; Settings → Environments → Production → Branch Tracking →
   `vercel`; Firewall → add the rate-limit rule (§4.6).
3. Executor: full gate on a CLI preview, then `git push origin vercel`.
   Verify `curl -sI https://thai-ler-dev.vercel.app` redirects to SSO (not
   200), `PLAYWRIGHT_BASE_URL=https://thai-ler-dev.vercel.app pnpm exec
playwright test e2e/live/health.spec.ts` passes with the bypass header,
   and a manual annotation by Tyler (logged in) works end-to-end.
4. Executor: `vercel domains add thai.ler.dev` (adds the domain to the
   project; prints the DNS records). Tyler: change DNS at the registrar;
   verify `https://thai.ler.dev` → SSO → app. The old AWS stack stays up
   until then and is decommissioned by Tyler later.
5. Executor: Tyler's data migration note — export the P0 library from the
   preview origin he used (Settings → Export), import it once on
   production (Settings → Import); the outbox pushes it to Blob.
6. Executor: update `CLAUDE.md` rule 3/9, `.claude/rules/deploy.md`,
   `README.md` ("production is deployed by pushing `vercel`"). The
   `.claude/settings.json` deny entries for `vercel --prod` **stay** —
   deploys are Git-triggered, the CLI never targets production.

---

## 5. Milestones

Status markers: `[ ]` todo, `[~]` in progress, `[x]` done + verified. Each
milestone ends with `pnpm check && pnpm test && pnpm test:e2e` green, a
commit, `pnpm test:e2e:vercel` green (M0, M1, M4, M5, M6 at minimum), the
Blob usage number noted in the commit body, and a push.

### M0 — Spike, scaffolding, deploy loop `[x]` (serial, one implementer + orchestrator)

1. Orchestrator: `vercel link --yes --project thai-ler-dev --scope
tylerschloessers-projects`; confirm `.env.local` exists with
   `VERCEL_AUTOMATION_BYPASS_SECRET` (§8; never print or `vercel env pull`
   into it). Install `@vercel/functions@3.9.7`, `@vercel/blob@2.8.0`,
   `@remix-run/node-fetch-server@0.14.1` (exact versions).
2. `tsconfig.api.json` (+ root reference), `api/health.ts` importing
   `../src/lib/time.ts` (extension) **and** `../src/llm/split.ts` (whose
   own imports are extensionless) — this is the import-resolution spike.
   `export const config = { maxDuration: 300 }` on `health.ts` too.
3. `vercel.json` per §10. `scripts/load-env.ts`, `scripts/vite-api-plugin.ts`
   (dev + preview), `.gitignore` `.data/`.
4. `api/_lib/{http,env,context}.ts` minimal; `api/_lib/store/{index,
memory,disk,vercel,paths}.ts` with unit tests (memory + disk; the vercel
   backend is exercised by `live/health` + a `store.vercel.test.ts` that is
   skipped without `BLOB_READ_WRITE_TOKEN`).
5. Env: replace the preview `ANTHROPIC_API_KEY` with a sensitive one;
   `openssl rand -hex 32 | vercel env add INTERNAL_SECRET preview` (and
   `development`); `vercel env add ALLOW_TEST_MODE preview` = `1`;
   `vercel blob create-store thai-ler-dev-preview --access private --region
iad1 --environment preview --environment development`.
6. `e2e/api-health.spec.ts` (fast) and `e2e/live/health.spec.ts` (`@live`);
   `scripts/e2e-vercel.sh` switches to `--grep @live` and re-verifies the
   CLI 59.16.0 stdout shape. Playwright `webServer.env` per §4.8.
7. Record spike results in this file (§10 "Corrected during M0"): does
   Vercel bundle extensionless `src/llm` imports? (If not: add `.ts`
   extensions to relative imports in `src/llm` and `src/lib`.) Is
   `getDeadline()` defined on Vercel and undefined locally? Do
   `api/annotation.ts` and the `api/annotation/` directory coexist as
   `/api/annotation` and `/api/annotation/<x>`? (If not: move the GET to
   `api/annotation/get.ts` and update §4.1.)
8. Context files: create `.claude/rules/api.md` (§6.2), update `deploy.md`,
   `testing.md`, `CLAUDE.md` (§6.1) — phrased for what exists at the end of
   M0.

Acceptance: local suite green; `pnpm test:e2e:vercel` green (health on a
real preview with `blobBackend: 'vercel'`); bundle check shows no key.

### M1 — Server core `[x]` (parallel-safe: `api/**`, `src/llm/provider.ts`, `src/llm/annotateLine.ts`, `src/lib/{records,merge}.ts`, `scripts/gen-fixture.ts`)

1. `src/lib/records.ts` (types), `src/lib/merge.ts` (`pickWinner`, moved
   from `snapshot.ts` with its tests), `src/llm/provider.ts`,
   `annotateLine` `onStart`.
2. `api/_lib/providers/{index,anthropic,fake}.ts` + tests (fake matches the
   fixture by Thai text; `fake-slow`; `thai_fake_error`).
3. `api/_lib/records.ts` (get/put/LWW/manifest/rebuild) + tests.
4. `api/_lib/runner.ts` + `hop.ts` + tests with a fake clock: warm-up gate,
   6-wide fan-out, `LINE_RESERVE_MS`, flush cadence (count the puts!),
   lease, cancel, hop decision and `MAX_HOPS`, stalled outcome on hop
   failure.
5. Handlers: `annotate`, `annotation`, `annotation/{resume,cancel,step}`,
   `sync/{manifest,record,manifest/rebuild}`, `test/{seed,namespace}` +
   handler tests via `Request`.
6. `scripts/gen-fixture.ts` on the runner + memory store; run it **once**
   with the real key only if `PROMPT_VERSION`/schema changed (they should
   not in P1).

Acceptance: `pnpm test` green; a Node smoke (`pnpm exec tsx
scripts/smoke-runner.ts`, memory store, fake-slow, `STEP_BUDGET_MS=2000`,
local hop to a `vite preview`) completes an 8-line job in ≥ 2 steps.

### M2 — Data layer v2 and sync client `[x]` (parallel-safe with M1: `src/db/**`, `src/sync/**`, `src/app/debug.ts`)

1. Dexie v2 + upgrade + tests (existing rows get `run`; `outbox`).
2. `repo.ts`: outbox enqueue in every write, `mergeRemote*`,
   `takeOutbox`/`clearOutbox`; delete server-only functions.
3. `snapshot.ts`: `schemaVersion: 2`, `upgradeSnapshot(v1)`, import enqueues
   outbox rows; tests for LWW, tombstones, v1 accept, v3 refuse.
4. `src/sync/*` per §4.5 with tests against a stubbed `fetch` (the API
   contract in §4.1 is the interface; M1 and M2 agree on it, not on code).
5. `debug.ts`: `window.__thai.sync`.

Acceptance: `pnpm test` green; a Vitest integration test drives `pull` →
`push` → `pull` against an in-process fake server built from M1's handlers
once both land (orchestrator adds it after merging M1 + M2).

### M3 — Client integration `[x]` (serial after M1 + M2)

1. `useAnnotate` → job client (§4.5); `AnnotateStatus` states running /
   stalled / failed / cancelled / complete; `Composer`, `DialogueView`
   unchanged in intent.
2. Settings: remove the API-key field + empty state; Sync section.
3. Delete `src/llm/client.ts`, `src/app/anthropic.ts`,
   `src/llm/pipeline.ts`, `envPrefix`; `scripts/check-bundle.test.ts`.
4. `e2e/fixtures.ts` rewrite; all fast specs in §4.8 green; suite timed
   (< 60 s, expect ~20 s because job specs wait on the 4 s poll — use
   `window.__thai.sync.pollNow()` where it matters).
5. Context files: `llm.md`, `data.md`, `ui.md`, `testing.md` accuracy pass.

Acceptance: fast suite green locally; `pnpm test:e2e:vercel` green
(`@live` health + annotate); manual walk on the preview URL: paste, close
the tab within 2 s, reopen `/d/:id` a minute later in a second browser
profile → complete.

### M4 — Live suite, hop verification, real-model smoke `[x]`

1. `e2e/live/{annotate,hop,sync,real-model}.spec.ts`; namespace teardown;
   `scripts/e2e-vercel.sh` prints the preview URL and the Blob usage
   reminder.
2. Run `live/hop` on a preview and record the outcome in §10 (hops seen,
   any 508). If 3 hops 508, lower `MAX_HOPS` and note it.
3. `E2E_REAL_MODEL=1 pnpm test:e2e:vercel --grep real-model` once; record
   the measured per-line latency and cost in §4.2.
4. Blob usage check in the dashboard; update the §4.3 budget with real
   numbers.

Acceptance: `@live` green twice in a row; measured numbers in this file.

### M5 — Hardening and docs `[x]`

1. Accessibility of the new status states (`aria-live` on stalled/resumed;
   Sync section labels).
2. Failure drills (documented in `README.md` "Operations"): store
   suspended (`BlobStoreSuspendedError` → readable toast, app stays usable
   offline), provider 401 (key rotated), hop 508 (job stalls → resume-on-
   open finishes it).
3. `README.md` rewrite for the new architecture; `CLAUDE.md` + rules
   accuracy pass; `PLAN.MD` status markers; tombstone purge also removes
   stale `outbox` rows.

Acceptance: `pnpm test:e2e:vercel` green; verifier confirms every path and
command claim in `CLAUDE.md`, rules and `README.md` is true.

### M6 — Production cutover `[ ]` (executor + Tyler; §4.10)

Acceptance: `https://thai-ler-dev.vercel.app` requires SSO and annotates a
real dialogue for Tyler; `live/health` passes against it with the bypass
header; `thai.ler.dev` resolves to Vercel after Tyler's DNS change; docs
and hard rules updated; Blob usage for the month noted.

---

## 6. Context-engineering deltas

### 6.1 `CLAUDE.md` (keep < 80 lines, 10 hard rules)

- Purpose paragraph: "…the Anthropic call is made by Vercel Functions in
  `api/`; records live in Vercel Blob with IndexedDB as the local read
  model; production is `https://thai.ler.dev`."
- Commands: add `pnpm test:e2e:vercel` = "CLI preview + `@live` specs";
  note `pnpm dev` serves `/api/*` too.
- Layout: add `api/` (`_lib/` not routed), `src/sync/`, `docs/plans/`.
- Hard rules (final form after M6; M0 writes the pre-cutover wording):
  1. `src/db/repo.ts` is the only write path to IndexedDB; remote records
     enter only through `src/sync` → `repo.mergeRemote*`.
  2. Never call the real Anthropic API from any test: the server runs the
     fake provider under test mode, the browser never talks to
     `api.anthropic.com` (the e2e route guard fails the test), and the
     real-model smoke runs only with `E2E_REAL_MODEL=1`.
  3. Production deploys **only** by pushing `vercel` after the full gate
     (`check`, `test`, `test:e2e`, `test:e2e:vercel`). Never `vercel --prod`
     / `vercel deploy --prod`; never set `ALLOW_TEST_MODE` or
     `MODEL_PROVIDER=fake` in the production environment.
  4. No semicolons, single quotes, Prettier decides everything else.
  5. No `enum`; `import type` for type-only imports.
  6. Semantic CSS tokens only.
  7. Never pass `thinking` or `temperature`; the server client always sets
     `timeout` and `maxRetries`.
  8. Bump `PROMPT_VERSION` and regenerate the fixture whenever the system
     prompt or schema changes.
  9. Commit after every verified task; push only after the full gate (a
     push is a production deploy).
  10. Never merge or touch `main`; secrets exist only in Vercel env and
      gitignored files (`.env.local`, `.env.development.local`); all Blob
      access goes through `api/_lib/store` with `useCache: false`.
- Rule-file table gains `.claude/rules/api.md`.

### 6.2 `.claude/rules/api.md` (new; `paths: ['api/**', 'scripts/vite-api-plugin.ts', 'tsconfig.api.json']`)

Contents: handler signature (`export function GET/POST/PUT/DELETE(request:
Request): Promise<Response>`, never a bare default export — that form is
treated as a Node `(req, res)` handler); routing (flat files, ids in query
params, `_lib/` not routed, no dynamic segments); imports (`../src/lib`,
`../src/llm` only; never `src/db`, `src/ui`, `src/features`; `.ts`
extensions on every relative import inside `api/`); error/JSON shape and
`no-store`; `context()` and the test-mode cookie table; `BlobStore` rules
(`useCache: false`, `allowOverwrite: true`, `ifMatch` on the manifest,
intermediate flushes never touch the manifest, the ops budget table);
runner invariants (lease, `LINE_RESERVE_MS`, `MAX_HOPS`, one hop per step,
never `supportsCancellation`); env var table; secrets (`INTERNAL_SECRET`,
bypass secret, never log a header); local loader notes (`ssrLoadModule` in
dev, `tsImport` in preview, `waitUntil` no-op locally).

### 6.3 Updates to existing rule files

- `llm.md`: delete the browser-client paragraph; add the provider
  interface, `onStart` warm-up rule, server client options, fake provider
  location, "no `dangerouslyAllowBrowser` anywhere"; keep everything about
  structured outputs, `.parse` stripping, caching layout, `PROMPT_VERSION`.
- `data.md`: Dexie v2 (`run`, `outbox`), snapshot v2 + v1 upgrade, shared
  types in `src/lib/records.ts`, `src/lib/merge.ts`, client-owned vs
  server-owned records, outbox invariants ("every repo write enqueues in
  the same transaction").
- `testing.md`: new mock contract (fake provider + cookies), namespace
  isolation and teardown, `seedServer`, the `@live` tag and what
  `test:e2e:vercel` runs, Blob ops per live run, `E2E_REAL_MODEL`, the
  bundle-secret test.
- `deploy.md`: Git-connected reality, env var table per environment, Blob
  stores, `vercel env pull` into `.env.development.local` only, production
  via push after M6, protection settings, WAF rule.
- `ui.md`: Sync section conventions; remove the "no API key" empty state
  from the list.

### 6.4 `.claude/agents/` and `.claude/settings.json`

- `implementer.md`: add "Before touching anything in a worktree, run `git
merge-base --is-ancestor origin/vercel HEAD || exit 1` and confirm
  `git log -1` shows a P1 commit; never write `.env.local`; never set
  `ALLOW_TEST_MODE` in Vercel `production`."
- `verifier.md`: add "count Blob writes in runner tests; a stale env-var or
  route claim in `api.md` is a FAIL".
- `settings.json`: allow `Bash(openssl rand *)`, `Bash(curl *)`,
  `Bash(tsx *)`; deny stays (`Read(./.env.local)`, `vercel --prod*`,
  `vercel deploy --prod*`); add deny `Bash(vercel env pull .env.local*)`
  and `Read(./.env.development.local)`.

---

## 7. Execution protocol (orchestrating Opus session)

Reuse `docs/plans/P0.md` §7 verbatim, with these additions:

1. **Worktree branch check.** P0 agent worktrees branched from `main`. Every
   brief starts with: `git merge-base --is-ancestor origin/vercel HEAD` must
   succeed and `git log --oneline -1` must show a commit from this plan's
   history; otherwise stop and report. The orchestrator creates worktrees
   with `EnterWorktree` only from a checkout on `vercel` and verifies the
   same before merging.
2. **Order**: M0 serial → M1 ∥ M2 (disjoint paths, contract in §4.1/§4.4)
   → M3 serial → M4 → M5 → M6. Merge each worktree after verifier PASS,
   then run the full local gate on `vercel` before committing.
3. **Gate before every push**: `pnpm check && pnpm test && pnpm test:e2e`,
   then `pnpm test:e2e:vercel`. After M6 the push deploys production.
4. **Secrets hygiene**: never print env values; `vercel env add` always via
   `printf '%s' "$VAR" | vercel env add NAME env [--sensitive]`; never run
   `vercel env pull` without an explicit non-`.env.local` filename.
5. **Real API usage**: `gen-fixture` only if the prompt/schema changed
   (should not happen in P1), `live/real-model` once per milestone that
   touches `src/llm` or providers, and the M3/M6 manual walks. Everything
   else is the fake provider.
6. **Blob usage**: after every `@live` run note advanced/simple ops from
   the dashboard (Storage → store → Usage) in the commit body; stop and ask
   Tyler if advanced ops exceed 1,500 in the current month.
7. **Corrections**: any platform behaviour that contradicts this plan is
   recorded as a "Corrected during Mx" paragraph in §10 (as P0 did), in the
   same commit as the fix.
8. Keep orchestrator context small; agents summarise; `/compact` past ~60 %.

---

## 8. Prerequisites for Tyler

1. **Re-create `.env.local`** in this checkout with
   `VERCEL_AUTOMATION_BYPASS_SECRET=<value>` (dashboard → Settings →
   Deployment Protection → Protection Bypass for Automation; the project
   already has one secret — copy it, or regenerate). The executor verifies
   it with `vercel api` (`protectionBypass` keys) and never reads the file.
2. Keep `ANTHROPIC_API_KEY` exported in the executor's shell (used for
   `vercel env add` and the optional real-model smoke).
3. Confirm the Vercel CLI is logged in as `tylerschloesser` (it is today;
   `vercel whoami`). The executor runs `vercel link` itself.
4. **At M6** (dashboard, ~10 minutes): Vercel Authentication → All
   Deployments; Environments → Production → Branch Tracking → `vercel`;
   Firewall → rate-limit rule on `POST /api/*`. Then the DNS change for
   `thai.ler.dev` at the registrar.
5. Budget: ≈ $1–3 of Anthropic usage across the real-model smokes and two
   manual walks; $0 Vercel (Hobby).
6. Optional: export the P0 library from the preview origin you used before
   M6 so it can be imported on production.

---

## 9. Risks and mitigations

| Risk                                                                 | Mitigation                                                                                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel does not bundle extensionless imports inside `src/llm`         | M0 spike on a real preview; fallback is `.ts` extensions everywhere in `src/llm`/`src/lib` (Vite and Vitest accept them).                                                                    |
| Recursion protection 508s the continuation hop                        | `MAX_HOPS = 3`, one hop per step, browser resume starts a fresh lineage; `live/hop` measures it in M4; worst case = resume-on-open only (still meets goal 2 for jobs ≤ 300 s).                |
| A step is killed at 300 s before its final flush                      | Flush cadence ≤ 25 s and on every error; `LINE_RESERVE_MS = 70 s`; lost work ≤ one in-flight wave; the lease expires and the client resumes.                                                 |
| Hobby Blob quota exhausted → store suspended for the month           | Budget in §4.3; live suite only at milestone ends; usage noted per run; `BlobStoreSuspendedError` mapped to a readable toast; the app keeps reading from IndexedDB.                            |
| Duplicate runners (two steps on one record)                           | Lease check on entry; `ifMatch` on the manifest; worst case is a duplicated line call (cost), never corrupted data (LWW by `updatedAt`).                                                       |
| Vercel Authentication on the custom domain misbehaves on mobile       | Unverified cookie lifetime/iOS behaviour; documented fallback is a one-time visit with `?x-vercel-protection-bypass=…&x-vercel-set-bypass-cookie=true`. Re-evaluate app-level token in P2 if it hurts. |
| `waitUntil` is a no-op locally, hiding timing bugs                    | Runner tests use a fake clock and `STEP_BUDGET_MS`; `live/hop` exercises the real deadline path.                                                                                              |
| Pushing `vercel` after M6 deploys production mid-milestone            | Rule 9: commit freely, push only after the full gate; Git preview URLs disappear for `vercel` after the switch, CLI previews remain.                                                          |
| Node 22 locally vs 24 on Vercel                                       | No Node-24-only APIs in `api/`; `tsx` handles TS locally; add `"engines": { "node": ">=22.18" }`.                                                                                             |
| `vercel deploy` stdout shape changed between CLI 56 and 59            | M0 re-verifies; the script already has a regex fallback.                                                                                                                                      |
| Context files drift                                                   | Verifier FAILs stale claims; M0, M3, M5, M6 accuracy passes.                                                                                                                                  |

---

## 10. Reference snippets (verified shapes)

**vercel.json**

```json
{
  "functions": { "api/**/*.ts": { "maxDuration": 300 } },
  "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }]
}
```

**tsconfig.api.json** (referenced from `tsconfig.json`)

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.api.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "types": ["node"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "moduleDetection": "force",
    "noEmit": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["api", "src/lib", "src/llm"]
}
```

**api/health.ts** (web-standard handler; the named export is what makes
Vercel treat the module as a web handler)

```ts
import { json } from './_lib/http.ts'
import { readEnv } from './_lib/env.ts'

export const config = { maxDuration: 300 }

export function GET(_request: Request): Response {
  const env = readEnv()
  return json({
    ok: true,
    provider: env.MODEL_PROVIDER,
    blobBackend: env.BLOB_BACKEND,
    testMode: env.ALLOW_TEST_MODE,
    sha: process.env['VERCEL_GIT_COMMIT_SHA'] ?? 'local',
  })
}
```

**api/\_lib/http.ts**

```ts
const NO_STORE = { 'cache-control': 'private, no-store', 'content-type': 'application/json' }
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: NO_STORE })
}
export function fail(kind: ErrorKind, message: string): Response {
  return json({ error: { kind, message } }, STATUS[kind])
}
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw new HttpError('bad_request', parsed.error.message)
  return parsed.data
}
```

**Vercel Blob backend** (`api/_lib/store/vercel.ts`)

```ts
import { del, get, list, put, BlobPreconditionFailedError } from '@vercel/blob'

async getJson(path) {
  const res = await get(path, { access: 'private', useCache: false })
  if (!res || !res.stream) return null
  return { value: await new Response(res.stream).json(), etag: res.blob.etag }
}
async putJson(path, value, opts) {
  try {
    const res = await put(path, JSON.stringify(value), {
      access: 'private', allowOverwrite: true, addRandomSuffix: false,
      contentType: 'application/json', ifMatch: opts?.ifMatch,
    })
    return { etag: res.etag }
  } catch (err) {
    if (err instanceof BlobPreconditionFailedError) throw new StorePreconditionError(path)
    throw err
  }
}
async list(prefix) {
  const out = []; let cursor: string | undefined
  do {
    const page = await list({ prefix, cursor, limit: 1000 })
    out.push(...page.blobs.map((b) => ({ pathname: b.pathname, url: b.url })))
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return out
}
```

**Manifest update with optimistic concurrency** (`api/_lib/records.ts`)

```ts
async function updateManifest(store, prefix, entry) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await store.getJson<Manifest>(`${prefix}manifest.json`)
    const next = current?.value ?? emptyManifest()
    next.entries[`${entry.kind}:${entry.id}`] = entry
    next.updatedAt = nowIso()
    try {
      await store.putJson(`${prefix}manifest.json`, next, { ifMatch: current?.etag })
      return next
    } catch (err) {
      if (!(err instanceof StorePreconditionError) || attempt === 1) throw err
    }
  }
}
```

**Runner core** (`api/_lib/runner.ts`, abridged)

```ts
import { getDeadline, waitUntil } from '@vercel/functions'

const CONCURRENCY = 6, LINE_RESERVE_MS = 70_000, FLUSH_EVERY_MS = 25_000, MAX_HOPS = 3

export async function runStep(ctx: RequestContext, annotationId: string): Promise<void> {
  const rec = await ctx.records.getAnnotation(annotationId)
  if (!rec || rec.run.state === 'done' || rec.run.state === 'cancelled') return
  if (rec.run.leaseUntil && Date.parse(rec.run.leaseUntil) > Date.now() + 5_000) return

  const deadline = Math.min(safeDeadline() - 20_000, Date.now() + ctx.stepBudgetMs)
  rec.run = { ...rec.run, state: 'running', steps: rec.run.steps + 1,
    leaseUntil: new Date(deadline + 30_000).toISOString() }
  let lastFlush = await flush()

  const pending = rec.lines.flatMap((l, i) => (l === null ? [i] : []))
  const queue = [...pending]
  if (!rec.lines.some((l) => l !== null) && queue.length > 1) {
    await new Promise<void>((resolve) => {
      void runLine(queue.shift()!, resolve).then(resolve) // resolve on onStart or on completion
    })
  }
  await runConcurrent(queue, CONCURRENCY, async (i) => {
    if (rec.run.state === 'cancelled' || Date.now() + LINE_RESERVE_MS > deadline) return
    await runLine(i)
    if (Date.now() - lastFlush > FLUSH_EVERY_MS) lastFlush = await flush()
  })

  const remaining = rec.lines.some((l) => l === null)
  if (remaining && rec.run.state === 'running') {
    rec.run.leaseUntil = new Date().toISOString()          // visibly stalled unless the hop takes over
    await flush()
    if (rec.run.hops < MAX_HOPS) await hop(ctx, annotationId) // never throws; logs failures
    return
  }
  rec.run = { ...rec.run, state: rec.run.state === 'cancelled' ? 'cancelled' : 'done', leaseUntil: null }
  rec.status = rec.lines.every((l) => l !== null) ? 'complete' : 'partial'
  await ctx.records.putAnnotation(rec, { manifest: true })
}

function safeDeadline(): number {
  try { return getDeadline() } catch { return Number.POSITIVE_INFINITY }
}
// api/annotate.ts: waitUntil(runStep(ctx, annotation.id).catch(log)); return json({ dialogue, annotation }, 202)
```

**Continuation hop** (`api/_lib/hop.ts`)

```ts
export async function hop(ctx: RequestContext, annotationId: string): Promise<boolean> {
  const base = process.env['VERCEL_URL'] ? `https://${process.env['VERCEL_URL']}` : ctx.origin
  const headers: Record<string, string> = { 'x-thai-internal': ctx.env.INTERNAL_SECRET }
  if (process.env['VERCEL_AUTOMATION_BYPASS_SECRET']) {
    headers['x-vercel-protection-bypass'] = process.env['VERCEL_AUTOMATION_BYPASS_SECRET']
  }
  if (ctx.testCookie) headers['cookie'] = ctx.testCookie // keeps thai_ns / thai_model / budget
  try {
    const res = await fetch(`${base}/api/annotation/step?id=${annotationId}`, { method: 'POST', headers })
    return res.status === 202
  } catch {
    return false
  }
}
// api/annotation/step.ts: requireInternal(request); rec.run.hops += 1; waitUntil(runStep(...)); return json({}, 202)
```

**Anthropic provider** (`api/_lib/providers/anthropic.ts`)

```ts
import Anthropic from '@anthropic-ai/sdk'
import { annotateLine } from '../../../src/llm/annotateLine.ts'

export function anthropicProvider(apiKey: string): LineProvider {
  const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 })
  return { name: 'anthropic', annotate: (opts) => annotateLine(client, opts) }
}
// annotateLine.ts addition, right after messages.stream(...):
// if (opts.onStart) stream.once('streamEvent', () => opts.onStart?.())
```

**Vite API plugin** (`scripts/vite-api-plugin.ts`, abridged)

```ts
import { createRequestListener } from '@remix-run/node-fetch-server'
import { tsImport } from 'tsx/esm/api'
import type { Plugin, ViteDevServer, PreviewServer } from 'vite'

export function apiPlugin(): Plugin {
  function mount(server: ViteDevServer | PreviewServer, load: (file: string) => Promise<Record<string, unknown>>) {
    server.middlewares.use('/api', async (req, res, next) => {
      const file = resolveApiFile(req.url ?? '') // api/<path>.ts, rejects '_' segments, must exist
      if (!file) return next()
      const mod = await load(file)
      const handler = mod[req.method ?? 'GET'] as ((r: Request) => Promise<Response>) | undefined
      if (!handler) { res.statusCode = 405; return res.end() }
      createRequestListener(handler)(req, res)
    })
  }
  return {
    name: 'thai-api',
    configureServer: (server) => mount(server, (f) => server.ssrLoadModule(f)),
    configurePreviewServer: (server) => mount(server, (f) => tsImport(f, import.meta.url)),
  }
}
```

**Playwright** (`playwright.config.ts` delta and fixture)

```ts
webServer: remote ? undefined : {
  command: 'pnpm build && pnpm preview --port 4173 --strictPort',
  url: baseURL, reuseExistingServer: true, timeout: 60_000,
  env: { BLOB_BACKEND: 'memory', MODEL_PROVIDER: 'fake', ALLOW_TEST_MODE: '1', STEP_BUDGET_MS: '250000' },
},
// e2e/fixtures.ts
context: async ({ context, baseURL }, provide, testInfo) => {
  const ns = `e2e-${testInfo.testId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 40)}`
  const url = new URL(baseURL!)
  await context.addCookies([
    { name: 'thai_ns', value: ns, domain: url.hostname, path: '/' },
    { name: 'thai_model', value: 'fake', domain: url.hostname, path: '/' },
  ])
  await provide(context)
  await context.request.delete(`/api/test/namespace?ns=${ns}`)
},
```

**scripts/e2e-vercel.sh** (delta)

```sh
echo "Preview: $url"
PLAYWRIGHT_BASE_URL="$url" pnpm exec playwright test --grep @live "$@"
echo "Reminder: note Blob usage (Storage → thai-ler-dev-preview → Usage) in the commit body."
```

**Commands**

```sh
vercel link --yes --project thai-ler-dev --scope tylerschloessers-projects
vercel blob create-store thai-ler-dev-preview --access private --region iad1 --environment preview --environment development
printf '%s' "$ANTHROPIC_API_KEY" | vercel env add ANTHROPIC_API_KEY preview --sensitive --force   # --force replaces the P0 plain var
openssl rand -hex 32 | vercel env add INTERNAL_SECRET preview
printf '%s' 1 | vercel env add ALLOW_TEST_MODE preview
vercel env pull .env.development.local --environment=development   # never plain `vercel env pull`
vercel api "/v9/projects/prj_mZ6rdu95y6OVvaHsmqpDkibFXKIv?teamId=team_4mFhw0OaMx19wdVvfq9sEZuX"  # protectionBypass, ssoProtection
vercel domains add thai.ler.dev                                     # M6
```

**Dexie v2** (`src/db/db.ts`)

```ts
this.version(2)
  .stores({
    dialogues: 'id, updatedAt, deletedAt',
    annotations: 'id, dialogueId, updatedAt',
    settings: 'key',
    meta: 'key',
    outbox: 'key, updatedAt',
  })
  .upgrade((tx) =>
    tx.table('annotations').toCollection().modify((row) => {
      row.run ??= { state: 'done', provider: 'anthropic', leaseUntil: null, hops: 0, steps: 0, lastError: null }
    }),
  )
```

**Sync pull** (`src/sync/pull.ts`, abridged)

```ts
export async function pull(): Promise<PullCounts> {
  const manifest = await api.getManifest()
  for (const entry of Object.values(manifest.entries)) {
    const local = await localUpdatedAt(entry.kind, entry.id)
    if (local !== null && local >= entry.updatedAt) continue
    const { record } = await api.getRecord(entry.kind, entry.id)
    await mergeRemote(entry.kind, record) // repo.mergeRemote* (LWW, tombstones win ties)
  }
  await setMeta('lastPullAt', nowIso())
}
```

**Corrected during M0** (2026-09-12):

- `vercel link --yes` on CLI 59.16.0 **creates `.env.local`** (it pulls the
  development environment), and `vercel blob create-store … --environment
  development` / `vercel env add … development` **update** it again. So
  "`.env.local` exists" no longer proves the bypass secret is there: check
  for the file _before_ linking. Such files also carry Vercel system
  variables (`VERCEL=1`, `VERCEL_ENV`, `VERCEL_URL`, …), so
  `scripts/load-env.ts` skips `VERCEL` and every `VERCEL_*` key except
  `VERCEL_AUTOMATION_BYPASS_SECRET` and `VERCEL_OIDC_TOKEN`. Otherwise a
  local process would believe it runs on Vercel.
- `envPrefix` was removed from `vite.config.ts` in **M0**, not M3. The M0
  acceptance requires a keyless bundle, but the preview build environment
  still has `ANTHROPIC_API_KEY`. Until M3 the P0 browser client on previews
  works only with the Settings key override.
- CLI 59.16.0 has `vercel curl <path> --deployment <url>` (beta), which
  adds the protection bypass itself. The M0 spike uses it, so the spike
  does not depend on `.env.local`. Playwright against a preview still needs
  `VERCEL_AUTOMATION_BYPASS_SECRET`.
- `vercel env add NAME preview --yes` on CLI 59.16.0 stored `ALLOW_TEST_MODE`
  as a **Secret** (sensitive) value by default. That is harmless: sensitive
  values are still readable at runtime. `INTERNAL_SECRET` is sensitive in
  `preview` on purpose, and plain in `development`, where sensitive is not
  allowed.
- **Spike results** (CLI preview `thai-ler-3xp1pvvv8`, 2026-09-12):
  1. **Imports: neither `.ts` nor extensionless specifiers work on
     Vercel.** The first deploy returned 500 `FUNCTION_INVOCATION_FAILED`
     on every function, with `ERR_MODULE_NOT_FOUND: Cannot find module
     '/var/task/api/_lib/http.ts' imported from /var/task/api/annotation.js`.
     `@vercel/node` transpiles each `.ts` file to its own `.js` file and
     does not bundle or rewrite specifiers. So every relative import in
     `api/**`, `src/lib/**` and `src/llm/**` now ends in **`.js`**. The
     sources stay `.ts`, and TypeScript bundler resolution, Vite, Vitest
     and tsx all map `.js` back to `.ts`. `scripts/import-extensions.test.ts`
     guards this. §6.2's "`.ts` extensions on every relative import inside
     `api/`" and the §9 fallback ("`.ts` extensions everywhere") are
     superseded. The `.ts`-extension `api/health.ts` snippet above is only
     a shape reference. After the fix, `/api/health` returns 200 with
     `spike.splitLines: 2`, so the `src/llm/split.ts` chain resolves.
     JSON imports reached from `api/` at runtime would need `with { type:
     'json' }`; none exist yet (M1's fake provider must mind this).
  2. **`getDeadline()`** is `(): Date | undefined` in `@vercel/functions`
     3.9.7. It is **defined on Vercel** (`spike.hasDeadline: true`) and
     `undefined` locally, where it never throws. The runner uses
     `getDeadline()?.getTime() ?? Infinity`, not the `try/catch` in the
     runner snippet.
  3. **`api/annotation.ts` and `api/annotation/` coexist**: `GET
     /api/annotation` and `POST /api/annotation/resume` hit separate
     functions. §4.1 stands. Unknown `/api/nope` and `/api/_lib/http` are
     plain 404s, not `index.html`, and `/settings` still gets the SPA
     rewrite.
  4. `VERCEL_GIT_COMMIT_SHA` is set even on CLI deploys (the local HEAD),
     so `health.sha` is meaningful on previews.
  5. Real Vercel Blob answers `put(…, { ifMatch })` on a **missing** blob
     with a generic `BlobError` ("The specified key does not exist."), not
     `BlobPreconditionFailedError`. `api/_lib/store/vercel.ts` maps that
     case to `StorePreconditionError` as well, and `store.vercel.test.ts`
     covers it against the real preview store.

**Corrected during M1/M2** (decided when writing the briefs, 2026-09-12):

- **Shared contract first.** `src/lib/records.ts` and `src/lib/merge.ts`
  (which gains `mergeSettingRows` and `settingsUpdatedAt`, the per-key LWW
  rule of the old `mergeSettings`) were committed before the M1/M2
  worktrees branched (`ac25fa8`). Both sides import them rather than each
  creating them. The settings record is `SettingRow[]` with no tombstones.
  Its manifest `updatedAt` is its newest row's.
- **Runner timing.** A fixed `LINE_RESERVE_MS = 70 000` would never start a
  line under a test budget of a few seconds. So `lineReserveMs =
  min(70 000, floor(budget / 2))`, and every step starts **at least one**
  pending line, which guarantees progress. At the plan's `fake-slow` 300 ms
  per line and 6-wide fan-out, an 8-line job finishes in under a second.
  That makes `job-hop` and `job-cancel` unobservable, so test mode gains a
  cookie `thai_fake_delay_ms` (0–60 000, forwarded on hops) that overrides
  the fake provider's per-line delay. The fake provider also synthesizes a
  minimal schema-valid annotation for text that is not in the fixture, so
  e2e can use dialogues of any length.
- **Cancellation across instances.** `cancel` may land on a different
  instance than the runner. The runner therefore re-reads the stored
  `run.state` before starting a line (at most every 5 s), at every flush and
  before its final write, and never overwrites `cancelled`.
- **Fewer manifest writes.** `putRecords([...], { manifest: true })` writes
  the blobs, then **one** manifest update covering all entries. So `POST
  /api/annotate` costs 3 advanced ops, not 4. An LWW upsert whose stored
  copy wins skips the put.
- **`createAnnotation` / `upsertAnnotationLine` / `finalizeAnnotation`**
  stay in `repo.ts`, deprecated, until **M3**: the browser pipeline uses
  them until M3 moves annotation to the server. §4.4's "deleted in M2" moves
  to M3.
- **Parallel Playwright.** Both worktrees would otherwise start `vite
  preview` on 4173 and, via `reuseExistingServer`, silently test each
  other's build. `playwright.config.ts` honours `E2E_PORT`, and M1 uses
  4174.
- **Agent worktrees branch from `origin/vercel`, not the local `HEAD`.**
  M0 was committed but not yet pushed (its gate waits on the bypass
  secret), so both worktrees started at `fb8a290`. The §7.1 pre-flight
  check caught it in both agents. Their trees were clean, and each was
  reset to `ac25fa8` before any edit. The pre-flight must therefore check
  for the expected commit, not just `--is-ancestor origin/vercel`, which
  passed here.
- **New env var `BLOB_DISK_ROOT`** (M1; used locally only). It overrides
  the disk backend's root (default `.data/blob/`) so
  `scripts/smoke-runner.ts` can use a throwaway directory. The smoke run
  also needs `pnpm preview` started as a detached process group: a plain
  `kill()` left an orphaned vite server behind.
- `POST /api/annotation/resume` decides "busy" from the lease alone. A live
  lease means a runner holds the record, whatever `run.state` says.
- **Pull diff vs. tombstone ties** (found by the M1↔M2 integration test,
  `scripts/sync-integration.test.ts`). The §10 "Sync pull" snippet skips
  an entry when `local >= entry.updatedAt`, which contradicts `pickWinner`:
  a tombstone wins a tie. So a delete carrying the same timestamp as the
  local copy never reached this browser. `pull.ts` now also fetches when
  the timestamps are equal and only the remote copy is a tombstone.
  Settings have no tombstones and keep the plain `>` comparison.
- **Outbox compare-and-delete needs a revision, not `updatedAt`.** A test
  that failed about 1 run in 10 found this (`repo.sync.test.ts`, "newer
  write landed mid-push"). Two writes to the same record in one millisecond
  share an `updatedAt`. `clearOutbox(key, updatedAt)` then deleted the
  _newer_ write's row, so that change was never pushed. Every outbox row
  now carries a unique `rev`, created on each enqueue, and `clearOutbox`
  compares that. `rev` is not indexed, so the store stays `key, updatedAt`
  and Dexie v2 is unchanged.

**Corrected during M3** (decided when writing the M3a brief, 2026-09-13):

- **Bundle secret check** lives in `e2e/bundle.spec.ts`, part of the fast
  Playwright suite, not in `scripts/check-bundle.test.ts`. The gate runs
  `pnpm test` _before_ any build, so a Vitest check on `dist/` would read a
  stale or missing bundle. Playwright's `webServer` builds first. The spec
  also asserts that `api.anthropic.com` and `dangerouslyAllowBrowser` are
  absent, which proves the SDK left the client.
- **A `queued` record with `leaseUntil: null`** (the runner never started,
  for example because the `annotate` function died before `waitUntil` ran)
  counts as live for 15 s after its `updatedAt` and as **stalled** after
  that. §4.4's derivation only covered an expired lease, which would have
  left such a job waiting forever.
- M3 runs as **M3a** (app wiring, deletions, the fixture rewrite, existing
  specs green), then **M3b** (the new job specs) and **M3c** (context-file
  accuracy pass) in parallel. The old specs cannot pass on the new flow
  until the fixtures change, so the app change and the fixture rewrite have
  to land together.
- **Runner: "attempted", not "non-null", decides the hop** (found in M3a;
  an M1 bug). The runner hopped whenever a line was still `null`, so a line
  that kept failing (a rate limit, a refusal) hopped `MAX_HOPS` times and
  then left the record `running` with an expired lease forever. It never
  reached §4.4's "failed" state (done + partial), so the UI could not offer
  Retry. Now a pending line counts as attempted once its provider call
  returns, whether it succeeded or failed. A step hops only when the
  deadline cut off lines that were **never attempted**. Otherwise it ends
  `done` with `status: 'partial'` and `lineErrors` kept, and Retry (=
  `resume`) re-runs the `null` lines in a new lineage.
- **"Terminal" means released, not just `done`/`cancelled`** (found in
  M3b's `job-cancel` spec). The client's watcher stopped as soon as it saw
  the cancel endpoint's own response. The runner then finished its
  in-flight lines, but the UI never saw them until some later pull. Now
  `cancel` leaves `run.leaseUntil` as it is, and the runner's final write
  clears it. `src/sync/poll.ts` treats a record as terminal only when
  `run.state ∈ done | cancelled` **and** the lease is `null` or expired. A
  cancelled record is never auto-resumed. `DialogueView`'s watch effect
  uses that same exported predicate. It used to watch only while `queued`
  or `running`, so the Cancel click's own merge unsubscribed it before the
  runner's final write. Related: a poller sees partial
  progress only at flushes, which come every 25 s, on a line error, and at
  step end. That is the Blob budget trade-off from §4.3, so a short job may
  show nothing until it finishes.

**Corrected during M4** (first Vercel runs, 2026-09-13):

- **Hobby allows at most 12 Serverless Functions per deployment**, and
  every `.ts` file under `api/` outside a `_`-prefixed directory counts,
  **tests included**. The first deploy of the merged tree failed with "No
  more than 12 Serverless Functions can be added to a Deployment on the
  Hobby plan": the 11 real routes plus 10 handler tests next to them. A
  `.vercelignore` now keeps `api/**/*.test.ts` out of the upload, along
  with `.env*`, `.vercel`, `.data` and `.claude`, whatever Vercel's
  defaults are. **11 of 12 functions are used, so a new route needs a
  merge or a Pro plan.**
- **Vercel's Node builder type-checks `api/` on its own terms.** It uses no
  `@types/node` and no strict mode, and prints `TS2591`/optional-property
  errors, but the build still completes. These errors are advisory. The
  real typecheck is `tsc -b` in `pnpm check`.
- **Hop on Vercel measured:** `live/hop` (14 lines, 2 s fake lines, 3 s
  step budget) finished with `run.hops = 2`, `run.steps = 3` on two
  consecutive runs, as derived locally. No 508 occurred, so `MAX_HOPS`
  stays 3. Both `@live` runs were green (7 passed, `real-model` skipped,
  about 11 s) on preview `thai-ler-9zvm97vro`.
- `ANTHROPIC_API_KEY` in `preview` has been **sensitive** since
  2026-09-13T05:24Z. Deployments built before that still carry the old
  plain value, so the real-model smoke runs on a fresh preview.
- **M3 manual walk** (scripted Playwright walk on the Git-built preview
  `thai-ler-i235itx5n` of `015067d`, real provider, `claude-sonnet-5`):
  profile A got the 202 and closed at 1.7 s. The job reached 5/8 lines on
  the server with no browser open. A fresh profile B opened `/d/:id` at
  62 s, and the job finished `complete` (8/8, one step, no hop) at about
  102 s, and the IndexedDB in profile B agreed. The Git-triggered build of
  `015067d` honoured `.vercelignore` (READY, 11 functions), and
  `live/health` passed against it.

- **Blob usage, measured** (dashboard, 2026-09-13, `thai-ler-dev-preview`,
  after the M0 store tests, three `@live` runs, the dry runs and the M3
  walk): **128 advanced / 223 simple ops**, 29.4 kB stored (the walk left
  its records under `v1/`), 460 kB transferred. That is about 6 % of the
  2 000 advanced-op allowance, so the §4.3 budget holds with room to
  spare. The per-job and per-live-run estimates there were, if anything,
  pessimistic.

---

## 11. Sources consulted (planning date; full notes in the session's research files)

- Vercel Functions: https://vercel.com/docs/functions · /docs/functions/functions-api-reference (config object, cancel requests) · /docs/functions/limitations · /docs/functions/runtimes/node-js · /docs/functions/streaming-functions · /docs/functions/configuring-functions/advanced-configuration · /docs/project-configuration/vercel-json#functions · #rewrites · /docs/frameworks/frontend/vite#using-vite-to-make-spas · /docs/fluid-compute#order-of-settings-precedence
- `@vercel/functions` (`waitUntil`, `getDeadline`): https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package · changelog: https://vercel.com/changelog/waituntil-is-now-available-for-vercel-functions · https://vercel.com/changelog/node-js-vercel-functions-now-support-fetch-web-handlers · https://vercel.com/changelog/node-js-vercel-functions-now-support-request-cancellation · https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute
- Recursion protection: https://vercel.com/changelog/automatic-recursion-protection-for-vercel-serverless-functions · https://vercel.com/docs/errors/INFINITE_LOOP_DETECTED
- System env vars (`VERCEL_URL`, `VERCEL_AUTOMATION_BYPASS_SECRET`): https://vercel.com/docs/environment-variables/system-environment-variables
- Workflow DevKit: https://vercel.com/blog/a-new-programming-model-for-durable-execution · https://workflow-sdk.dev/docs/getting-started/vite · /docs/workflows/pricing · https://vercel.com/changelog/workflow-steps-now-support-extended-function-durations
- Queues: https://vercel.com/docs/queues · /docs/queues/concepts · /docs/queues/sdk · /docs/queues/pricing · https://vercel.com/changelog/vercel-queues-now-in-public-beta
- Cron: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Vercel Blob: https://vercel.com/docs/vercel-blob · /docs/vercel-blob/using-blob-sdk (put/get/head/list/del) · /docs/vercel-blob/private-storage#consistent-reads · #accessing-without-the-sdk · /docs/vercel-blob/public-storage#configuring-cache-duration · /docs/vercel-blob#conditional-writes · /docs/vercel-blob/usage-and-pricing · /docs/vercel-blob/server-upload · /docs/cli/blob · changelogs: https://vercel.com/changelog/vercel-private-blob-is-now-generally-available · https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage · https://vercel.com/changelog/increased-blob-store-limit-for-hobby-users · SDK changelog: https://github.com/vercel/storage/blob/main/packages/blob/CHANGELOG.md
- Deployment protection & auth: https://vercel.com/docs/deployment-protection · /docs/deployment-protection/methods-to-protect-deployments/vercel-authentication · /docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation · https://vercel.com/changelog/protect-production-deployments-for-free-on-every-plan · https://vercel.com/changelog/more-secure-deployment-protection · REST: https://vercel.com/docs/rest-api/reference/endpoints/projects/update-an-existing-project · production-branch note: https://community.vercel.com/t/rest-api-docs-for-updating-production-git-branch/820
- WAF rate limiting on Hobby: https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting#limits · https://vercel.com/changelog/rate-limiting-now-available-on-hobby-with-higher-included-usage-on-pro
- CDN caching of function responses: https://vercel.com/docs/caching/cdn-cache · /docs/caching/cache-control-headers
- Git integration: https://vercel.com/docs/git#preview-branches · CLI: https://vercel.com/docs/cli/dev · /docs/cli/env · /docs/cli/pull · /docs/cli/deploy · /docs/builds/configure-a-build#development-command
- Node type stripping: https://nodejs.org/docs/latest-v22.x/api/typescript.html · https://nodejs.org/docs/latest-v24.x/api/typescript.html
- Vite plugin hooks: https://vite.dev/guide/api-plugin (configureServer / configurePreviewServer) · https://vite.dev/config/preview-options
- Adapter: https://github.com/remix-run/remix/tree/main/packages/node-fetch-server · alternatives https://hono.dev/docs/getting-started/nodejs · https://srvx.h3.dev/guide/node
- Playwright web servers / fixtures: https://playwright.dev/docs/test-webserver · https://playwright.dev/docs/test-fixtures
- Vitest 5: https://vitest.dev/guide/ · issues on jsdom + Request: https://github.com/vitest-dev/vitest/issues/8374
- Anthropic: https://platform.claude.com/docs/en/api/sdks/typescript (timeouts, retries, long requests) · /docs/en/build-with-claude/prompt-caching (concurrency, TTL, minimums) · /docs/en/build-with-claude/structured-outputs · /docs/en/build-with-claude/batch-processing · /docs/en/api/messages/batches/create · /docs/en/api/messages (stop_details) · /docs/en/about-claude/pricing · /docs/en/about-claude/models/overview · SDK: https://github.com/anthropics/anthropic-sdk-typescript (README, CHANGELOG, src/client.ts, src/lib/MessageStream.ts, src/resources/messages/batches.ts)
- Prior plan and as-built record: `docs/plans/P0.md`
