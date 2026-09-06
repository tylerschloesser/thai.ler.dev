---
paths:
  - "infra/cdk/**"
  - ".github/workflows/**"
---

# infra/cdk and AWS

Loaded when you touch `infra/cdk/` or the GitHub workflows that deploy it.

- ESM + `nodenext`: relative imports use `.js` extensions even though the sources are `.ts`
  (`import { SiteStack } from '../lib/site-stack.js'`). The app runs through `tsx`.
- Everything is in **us-east-1** — CloudFront requires its ACM certificate there. `env` is set
  explicitly in `bin/app.ts` because the `admin` profile has no default region.
- **Three permanent stacks, plus one that only exists on demand.** `ThaiLerDevSharedStack`
  (the wildcard ACM cert for `thai.ler.dev` + `*.thai.ler.dev`), `ThaiLerDevSiteStack` (the
  API and the production site) and `ThaiLerDevGithubOidcStack`. `ThaiLerDevPreview<n>Stack`
  is added by `bin/app.ts` only when `-c pr=<n>` is passed, with `-c preview=frontend` or
  `-c preview=full-stack`; a bare `cdk list` must keep showing exactly the three.
  Both preview modes have now been deployed and deleted for real, so treat a failure there as
  a regression rather than as untested ground.
- Cross-stack values travel through **explicit** `CfnOutput { exportName }` and
  `Fn.importValue`, not CDK's automatic references, because `cdk.json` sets
  `@aws-cdk/core:defaultCrossStackReferences: "weak"`. The three names are in `lib/dns.ts`
  (`CERT_EXPORT`, `API_URL_EXPORT`, `API_ARN_EXPORT`); a preview stack's own outputs carry no
  `exportName`, because two previews would collide on it.
- `addSite` (`lib/site.ts`) reads `apps/web/dist` and throws if it's missing, so run
  `pnpm build` before `cdk synth` or `cdk deploy`. That is why a preview is torn down with
  `delete-stack` and not `cdk destroy` — see **Previews**.
- `esbuild` is a **root** devDependency, not `infra/cdk`'s: `NodejsFunction` runs the bundler
  from the workspace root (where the lockfile is), so that is where the binary must resolve.
  Without it CDK silently falls back to Docker bundling. Root `package.json` records this in a
  `"//"` key — don't drop it in a manifest rewrite.
- Prod keeps the API and the site in one stack, but **not** because splitting them is a cycle
  any more. `addSite` takes a `lambda.IFunctionUrl`, and
  `FunctionUrlOrigin.withOriginAccessControl` writes its `InvokeFunctionUrl` permission into
  the *distribution's* own scope — so a frontend preview points `/api/*` at production
  through `ImportedFunctionUrl` (`lib/imported-function-url.ts`), fed by `SiteStack`'s two
  exports, with no cycle. `ImportedFunctionUrl` gets away with being a stub because that OAC
  helper only ever reads `.url`, `.functionArn` and `.authType`.
- Two `BucketDeployment`s, and the asymmetry is load-bearing: assets deploy with
  `prune: true`, then HTML with `prune: false` plus an explicit `addDependency`. Giving the
  second one `prune: true` would delete every hashed asset the first just uploaded.
- Files with build-stable names must stay in the `UNVERSIONED` list in `lib/site.ts` so
  they deploy `no-cache`; a service worker pinned `immutable` for a year would outlive its own
  replacement at every edge. The same is why nothing goes in `apps/web/public/` that might be
  edited in place.
- `GithubOidcStack` is deployed **locally only, never from CI** — it grants CI its own trust.
  Its trust policy must keep both the immutable and the legacy GitHub OIDC `sub` forms; this
  repo was created after 2026-07-15, so it emits the immutable one. It carries four subs, in
  both forms: `:ref:refs/heads/main` for `deploy.yml` and `:pull_request` so a per-PR preview
  can deploy and destroy its own stack. The role's `cloudformation:DeleteStack` and
  `dynamodb:PutItem`/`BatchWriteItem` grants are scoped to `ThaiLerDevPreview*` on purpose —
  CI must not be able to delete or seed production.
- The worker Lambda's 10-minute timeout is paired with the SDK client's 9-minute one in
  `apps/api`; `.claude/rules/api.md` says why they move together.

## Three CloudFront gotchas that each cost a debugging session

1. **`lambda:InvokeFunction` must be granted alongside `lambda:InvokeFunctionUrl`.** Lambda
   started requiring both on function URLs around Oct 2025; CDK's
   `withOriginAccessControl` still grants only the latter (aws/aws-cdk#35872), so
   `lib/site.ts` adds the second explicitly. Symptom: every request 403s and **nothing
   appears in the function's logs**, because the auth layer rejects it before invocation.
2. **POST bodies must carry `x-amz-content-sha256`.** OAC signs origin requests with SigV4
   and Lambda rejects unsigned payloads, so `apps/web/src/db/api.ts` hashes every request
   body. A POST without it is answered 403.
3. **The origin request policy must exclude `host` and only `host`**
   (`ALL_VIEWER_EXCEPT_HOST_HEADER`). The deny list applies to the final outbound headers,
   which include the `Authorization` header OAC just added — denying `authorization` strips
   CloudFront's own signature. This is why viewer auth tokens travel in `x-id-token`.

Related: SPA fallback is a CloudFront **Function** on the default behavior, not
distribution-wide `errorResponses`. Custom error responses apply to every behavior, so a 403
or 404 from `/api/*` would come back as the HTML shell with status 200. The function only
rewrites URIs containing no `.`, so a genuinely missing asset still 404s.

## AWS access

Local access is SSO: `aws sso login --profile admin`, then prefix commands with
`AWS_PROFILE=admin`. Account `063257577013`.

`.github/workflows/ci.yml` runs lint → typecheck → build → `pnpm test:e2e` on every pull
request. It touches no AWS credentials at all: the suite runs against the in-process API.

CI (`.github/workflows/deploy.yml`) deploys `ThaiLerDevSharedStack ThaiLerDevSiteStack` on
push to `main` via OIDC, assuming the role in the repo variable `AWS_DEPLOY_ROLE_ARN`. It runs
the same lint/typecheck/build/`test:e2e` sequence **before** `configure-aws-credentials`, so a
red suite stops the run before it can reach the account. Deploying by hand means naming the
stacks, because the root `pnpm deploy` runs `cdk deploy` with no stack argument.

The Anthropic API key lives in the Secrets Manager secret `thai-ler-dev/anthropic`, created
out of band and imported by name — never in CDK source or a Lambda environment variable.

`.github/workflows/claude.yml` is the Claude Code GitHub Action, unrelated to deploys. It runs
in interactive mode on `@claude` mentions and authenticates with the `CLAUDE_CODE_OAUTH_TOKEN`
repository secret: a subscription token from `claude setup-token`, chosen over an API key
because the account's API key carries no credit. The Claude GitHub App must be installed on
the repo for it to comment or open PRs. It installs pnpm, dependencies and the Playwright
chromium build before the Claude step so `pnpm lint`, `typecheck`, `build` and `test:e2e` all
work in the run — `test:e2e` is in `--allowedTools`, and the browser install is unconditional
because whether a run needs it is only known once Claude has read the request. Keep those
steps in sync with `ci.yml` and `deploy.yml`. Because it also triggers on `issues: opened`, an
issue whose body contains `@claude` starts a run when created, which is why the issue-filing
skills forbid the phrase.

## Previews

`.github/workflows/preview.yml`, driven by the labels `preview:frontend` and
`preview:full-stack`. Exactly one may be set: both at once posts a conflict comment and fails
the run rather than picking one.

- Both conditions read `github.event.pull_request.labels`, never `github.event.label` — on an
  `unlabeled` event `pull_request.labels` has already dropped the removed label, which is the
  state the destroy condition needs to see.
- Every AWS job requires `pull_request.head.repo.full_name == github.repository`: a fork gets
  no OIDC token, so without it the job would fail at `configure-aws-credentials` rather than
  skip cleanly.
- Three of the deploy flags are load-bearing. `--exclusively`, because this role can assume the
  CDK bootstrap roles, so a run that pulled in a dependency stack could deploy unreviewed PR
  code to production. `--outputs-file "$GITHUB_WORKSPACE/preview-outputs.json"` must be
  **absolute**, because `pnpm --filter cdk exec` runs in `infra/cdk/` while the seed step that
  reads it runs at the repo root. `-c modelProvider=fake`, because the Anthropic key has no
  credit and a full-stack preview on the real model would land every translation `Failed`;
  the cost is that a preview never exercises the Anthropic path.
- The seed step runs **after** `configure-aws-credentials` and inherits its `AWS_REGION`:
  `pnpm --filter api seed` talks to DynamoDB directly, not through CDK, and the OIDC role's
  `dynamodb:PutItem` on `ThaiLerDevPreview*` is what lets it.
- `concurrency: preview-<pr>` with `cancel-in-progress: false` — a run cancelled
  mid-CloudFormation leaves the stack `*_IN_PROGRESS` for a human to dig out.
- `destroy` runs `describe-stacks` first, so a closed PR that never had a preview does not
  claim it destroyed one, then `delete-stack` without `--wait`. CloudFront deletion takes
  5-15 minutes, so re-labelling inside that window fails on `DELETE_IN_PROGRESS`. The role
  needs no `iam:PassRole`: CloudFormation reuses the `cdk-hnb659fds-cfn-exec-role` stored on
  the stack rather than being passed one.
- One sticky `gh pr comment --edit-last --create-if-none` per PR. It is the only place a human
  is told that a frontend preview reads and writes **production data**.
