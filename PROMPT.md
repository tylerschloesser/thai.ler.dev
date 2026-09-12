# Kickoff prompt: plan P1 for thai.ler.dev

Paste everything below this line into a fresh Claude Code session opened at
the repo root on branch `vercel`. (Add `ultrathink` at the end if you want
deeper reasoning.)

---

We are planning the next phase (P1) of thai.ler.dev, a personal Thai-learning
app. P0 is shipped and verified; this session's job is to **produce the P1
plan, not to implement it**. The plan will be executed later by a single
long-running Opus session that delegates most work to Sonnet sub-agents,
exactly as P0 was. Research every library, platform feature, and limit via
sub-agents before relying on it; verify versions with `npm view`; cite
sources. Confirm decisions with me (Tyler) with `AskUserQuestion` before
finalizing. Commit and push the result to `vercel` when done (no PRs).

## What P1 must deliver

1. **Move the Anthropic call to the backend.** Today `src/llm/client.ts`
   creates a browser client with `dangerouslyAllowBrowser: true` and the key
   is inlined into the bundle via `envPrefix: ['VITE_', 'ANTHROPIC_API_KEY']`
   in `vite.config.ts`. That is the only reason nothing is deployed to
   production. After P1 the key must exist only in Vercel function env, the
   client bundle must contain no key, and production becomes deployable.

2. **Make annotation resilient to the client disconnecting.** I want to
   submit a dialogue, switch tabs, close the browser, or come back later on
   another browser, and see the annotation finished. Execution must not
   depend on the submitting tab staying alive, and the results must not
   depend on the submitting browser's IndexedDB.

3. **Store the DB in Vercel Blob so it migrates across browsers, as naively
   as possible but efficiently.** Assume a single user and a single active
   browser at a time: no concurrent writers, no conflict resolution beyond
   what already exists (`mergeSnapshot` last-writer-wins + tombstones in
   `src/db/snapshot.ts`). "Efficient" means a change should not re-upload the
   whole database; a fresh browser should be able to pull everything and be
   fully usable; IndexedDB stays the local read model so the app still works
   offline for reading. I explicitly want Blob, not a database product.

Everything else in `PLAN.MD` §5b (summary, effort knob, IPA, audio, ask-a-
question) stays out of P1 unless it falls out for free.

## Read first, in this order

- `CLAUDE.md`, then `.claude/rules/*.md` (all five), then `PLAN.MD` end to end.
  PLAN.MD is the P0 plan annotated as-built; §4.1 (data model), §4.2 (LLM
  pipeline: per-line parallel calls, cached prefix, resume), §4.5 (the
  sync-readiness design P1 now builds on), §4.6 (test strategy: Anthropic is
  mocked at the browser network layer, which P1 breaks), §4.7 (deploy flow),
  §5b (next list), §7 (execution protocol to reuse), and §10 (verified
  snippets, including the bugs P0 found in `vercel deploy` output and
  Playwright async predicates).
- Code that P1 changes or must integrate with: `src/llm/pipeline.ts`,
  `src/llm/annotateLine.ts`, `src/llm/client.ts`, `src/llm/prompt.ts`,
  `src/llm/schema.ts`, `src/features/annotate/useAnnotate.ts`,
  `src/db/db.ts`, `src/db/repo.ts`, `src/db/snapshot.ts`, `src/app/debug.ts`,
  `e2e/fixtures.ts`, `e2e/mocks/anthropic.ts`, `playwright.config.ts`,
  `scripts/e2e-vercel.sh`, `scripts/gen-fixture.ts`, `vercel.json`,
  `vite.config.ts`, `.claude/settings.json`.

## Verified environment facts (2026-09-12, do not re-derive; do re-verify anything marked *verify*)

- Vercel team `tylerschloessers-projects` is on the **Hobby** plan. Project
  `thai-ler-dev` (`prj_mZ6rdu95y6OVvaHsmqpDkibFXKIv`, team
  `team_4mFhw0OaMx19wdVvfq9sEZuX`): framework Vite, Node 24, **Fluid compute
  enabled**, functions region `iad1`, no `functions` config in `vercel.json`
  yet (only the SPA rewrite).
- The project has a GitHub link (`tylerschloesser/thai.ler.dev`) with
  **`productionBranch: main`**. `main` is an unrelated older AWS/CDK app.
  A push to `main` would therefore deploy the wrong code to production.
  P0 deployed only via `vercel deploy --yes` from the CLI. *Verify* whether
  pushes to `vercel` also create Git-triggered preview deployments.
- Deployment protection: `ssoProtection.deploymentType = all_except_custom_domains`.
  On planning day the production alias `thai-ler-dev.vercel.app` answered
  200 without SSO. *Verify* current behavior before relying on it.
- Env: `ANTHROPIC_API_KEY` exists in the Vercel **preview** environment only
  (as a plain, non-sensitive var; Vite needed it at build time). The
  `VERCEL_AUTOMATION_BYPASS_SECRET` lives only in the gitignored `.env.local`
  and is verified via `vercel api "/v9/projects/<id>?teamId=<team>"` →
  `protectionBypass`; `vercel env pull` does **not** include it and would
  clobber `.env.local`.
- **No Blob store exists yet** (`vercel blob list-stores` → none). Vercel CLI
  56.4.1 has `vercel blob {list,put,get,del,copy,signed-token,presign,
  create-store,delete-store,get-store,list-stores,empty-store}`.
- Latest npm versions on planning day: `@vercel/blob` 2.8.0, `@vercel/functions`
  3.9.7 (provides `waitUntil`), `workflow` 4.8.8 (Vercel Workflow DevKit),
  `@vercel/queue` 0.5.1, `vercel` CLI 59.16.0 (56.4.1 installed),
  `@anthropic-ai/sdk` 0.125.0 (installed). Re-check all.
- `thai.ler.dev` DNS currently points at the old AWS deployment. Cutting
  production over to Vercel needs a DNS change by me; plan it as a
  Tyler-action step, not something the executor does.
- Agent worktree isolation branched off `main`, not the current branch,
  during P0. The P1 execution protocol must tell agents to verify their
  worktree HEAD is on `vercel`'s history before touching anything.

## Research the planner must do (sub-agents, with sources)

1. **Vercel Functions in a Vite project**: `api/` directory conventions,
   supported handler signatures (web-standard `Request`/`Response` vs
   Node `req,res`), TypeScript support, `vercel.json` `functions` /
   `maxDuration`, Hobby + Fluid limits (max duration, memory, concurrency),
   and what happens to an in-flight invocation when the HTTP client
   disconnects, for both buffered and streaming responses.
2. **Durable background execution on Hobby**, evaluated against goal 2:
   `waitUntil` post-response work; self-chaining invocations (each call
   annotates one line, persists it, then triggers the next pending line);
   Vercel Workflow DevKit (`workflow`; does it support a plain Vite + `api/`
   project or only Next/Nitro/Express; Hobby availability and pricing);
   Vercel Queues (`@vercel/queue`; status, Hobby availability); Vercel Cron
   limits on Hobby; and the **Anthropic Message Batches API** as a very
   different option (async by design, results retrievable for 29 days, 50%
   cheaper, but latency from minutes to hours; structured outputs support
   in batches). Recommend one primary mechanism and say why the others lost.
3. **Vercel Blob** for goal 3: server SDK surface in 2.8.0 (`put`, `get`,
   `head`, `list`, `del`, `allowOverwrite`, `addRandomSuffix: false`,
   private access), read-after-write consistency and CDN caching
   (`cacheControlMaxAge`, `useCache: false`) for a "read the record I just
   wrote" pattern, Hobby quotas (storage, simple/advanced operations, data
   transfer, list pagination limits), how `BLOB_READ_WRITE_TOKEN` is
   provisioned per environment, and local dev access to the store.
4. **Auth for a public production URL**: Vercel Authentication with
   "All Deployments" (does Hobby allow protecting production custom domains;
   does the automation bypass still work), versus a minimal app-level
   secret on `/api/*`. Recommend one.
5. **Local dev and e2e with functions present**: `vercel dev` vs a Vite
   dev-server middleware vs `vite-plugin-vercel`; how Playwright's
   `webServer` should start the API locally; keeping the suite under 60 s;
   how to isolate Blob state between test runs and between local and
   preview (namespace prefix per run, or mock `/api/*` at the browser layer
   for the fast suite plus a small live suite against the preview); and a
   server-side fake model provider for tests and previews **without**
   repeating the old app's mistake where previews never exercised the real
   model path (see PLAN.MD §1 prior-art findings).
6. **SDK usage server-side**: Node client (no browser flag), streaming vs
   non-streaming per line now that the browser is not the consumer,
   `max_tokens`, prompt caching across invocations (cache is per model and
   prefix; concurrency across functions is fine), Batches API request
   shape with `output_config` if that path is chosen.

## Design direction (a starting point, not a decision; the plan must justify or replace it)

- **Job model**: `POST /api/annotate` persists a job `{id, dialogueId,
  model, promptVersion, lines: (LineAnnotation|null)[], lineErrors, status}`
  to Blob and starts execution; `GET /api/jobs/:id` returns it. The client
  polls while open and, on any later load, reconciles pending jobs. The
  existing `AnnotationRecord` shape is already this, so the job *is* the
  annotation record.
- **Blob layout** (single-writer, per-record so writes are small):
  `v1/manifest.json` (`{id, kind, updatedAt, deletedAt}` for every record),
  `v1/dialogues/<id>.json`, `v1/annotations/<id>.json`, `v1/settings.json`.
  Client on load: fetch manifest → diff against IndexedDB → pull changed
  records → `mergeSnapshot`. Client on write: push the record, then the
  manifest. All Blob access goes through `api/` (the RW token never reaches
  the browser).
- **What changes in the client**: `src/llm/*` moves to a shared package or
  `api/_lib/` (schema, prompt, split, and the invariant checker remain
  shared with the UI); `useAnnotate` becomes "create job → poll";
  `client.ts` and `envPrefix` are deleted; the Settings API-key override is
  removed or repurposed.
- **Production cutover** is its own milestone at the end: flip CLAUDE.md
  hard rule 3 and the `.claude/settings.json` deny entries, decide how
  `main`/`productionBranch` is handled (options: repoint
  `productionBranch` to `vercel` via `vercel api` PATCH, or fast-forward
  `main` to `vercel` after archiving the old history in a tag), enable the
  chosen auth, then the DNS step for me.

## Deliverables of this planning session

1. Move the current `PLAN.MD` verbatim to `docs/plans/P0.md` as the as-built
   record, and fix every reference to it (`CLAUDE.md` "Layout" and the
   closing line, any rule file that cites a PLAN.MD section).
2. Write the new `PLAN.MD` for P1 with the same skeleton as P0: goal and
   scope, decisions confirmed with Tyler, stack deltas with verified
   versions, architecture (API, job execution, Blob layout, client changes,
   auth, testing, deploy, production cutover), milestones with acceptance
   criteria and named e2e specs, context-engineering deltas (a new
   `.claude/rules/api.md` scoped to `api/**`, updates to `llm.md`,
   `testing.md`, `deploy.md`, `CLAUDE.md` hard rules), execution protocol
   (reuse P0 §7 plus the worktree-branch check), prerequisites for Tyler,
   risks, verified reference snippets, and sources.
3. Ask me the decisions that materially change the plan before you finalize
   (expected: background-execution mechanism and acceptable latency, auth
   approach, whether production cutover is in P1 or deferred, Blob layout
   naming if you deviate from the direction above).
4. Commit `PLAN.MD`, `docs/plans/P0.md`, and any context-file edits to
   `vercel` and push. Do not implement anything else in this session.

Keep the plan as concrete as P0's: exact commands, exact file paths, exact
versions, and no claim about the repo that is not true at the moment you
write it.
