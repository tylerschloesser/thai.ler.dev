---
paths:
  - "infra/cdk/**"
  - ".github/workflows/**"
---

# infra/cdk and AWS

Loaded when you touch `infra/cdk/` or the GitHub workflow that deploys it.

- ESM + `nodenext`: relative imports use `.js` extensions even though the sources are `.ts`
  (`import { SiteStack } from '../lib/site-stack.js'`). The app runs through `tsx`.
- Everything is in **us-east-1** — CloudFront requires its ACM certificate there. `env` is set
  explicitly in `bin/app.ts` because the `admin` profile has no default region.
- `SiteStack` reads `apps/web/dist` and throws if it's missing, so run `pnpm build` before
  `cdk synth` or `cdk deploy`.
- `esbuild` is a **root** devDependency, not `infra/cdk`'s: `NodejsFunction` runs the bundler
  from the workspace root (where the lockfile is), so that is where the binary must resolve.
  Without it CDK silently falls back to Docker bundling. Root `package.json` records this in a
  `"//"` key — don't drop it in a manifest rewrite.
- The API is in `SiteStack`, not its own stack: `FunctionUrlOrigin.withOriginAccessControl`
  adds a resource policy scoped to the distribution's ARN, so splitting them is a cycle.
- Two `BucketDeployment`s, and the asymmetry is load-bearing: assets deploy with
  `prune: true`, then HTML with `prune: false` plus an explicit `addDependency`. Giving the
  second one `prune: true` would delete every hashed asset the first just uploaded.
- Files with build-stable names must stay in the `UNVERSIONED` list in `site-stack.ts` so
  they deploy `no-cache`; a service worker pinned `immutable` for a year would outlive its own
  replacement at every edge. The same is why nothing goes in `apps/web/public/` that might be
  edited in place.
- `GithubOidcStack` is deployed **locally only, never from CI** — it grants CI its own trust.
  Its trust policy must keep both the immutable and the legacy GitHub OIDC `sub` forms; this
  repo was created after 2026-07-15, so it emits the immutable one.
- The worker Lambda's 10-minute timeout is paired with the SDK client's 9-minute one in
  `apps/api`; `.claude/rules/api.md` says why they move together.

## Three CloudFront gotchas that each cost a debugging session

1. **`lambda:InvokeFunction` must be granted alongside `lambda:InvokeFunctionUrl`.** Lambda
   started requiring both on function URLs around Oct 2025; CDK's
   `withOriginAccessControl` still grants only the latter (aws/aws-cdk#35872), so
   `site-stack.ts` adds the second explicitly. Symptom: every request 403s and **nothing
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

CI (`.github/workflows/deploy.yml`) deploys `ThaiLerDevSiteStack` on push to `main` via OIDC,
assuming the role in the repo variable `AWS_DEPLOY_ROLE_ARN`. Deploying by hand means naming
the stack, because the root `pnpm deploy` runs `cdk deploy` with no stack argument and the
app has two.

The Anthropic API key lives in the Secrets Manager secret `thai-ler-dev/anthropic`, created
out of band and imported by name — never in CDK source or a Lambda environment variable.

`.github/workflows/claude.yml` is the Claude Code GitHub Action, unrelated to deploys. It runs
in interactive mode on `@claude` mentions and authenticates with the `CLAUDE_CODE_OAUTH_TOKEN`
repository secret: a subscription token from `claude setup-token`, chosen over an API key
because the account's API key carries no credit. The Claude GitHub App must be installed on
the repo for it to comment or open PRs. It installs pnpm and dependencies before the Claude
step so `pnpm lint`, `typecheck` and `build` work in the run; keep those steps in sync with
`deploy.yml`. Because it also triggers on `issues: opened`, an issue whose body contains
`@claude` starts a run when created, which is why the issue-filing skills forbid the phrase.
