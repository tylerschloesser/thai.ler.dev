# thai.ler.dev

Source for https://thai.ler.dev — an offline-first reader for Thai dialog. Paste a
conversation and each line comes back split into words, romanized, glossed and
tone-marked; select any span to ask a follow-up question about it.

## Layout

```
thai.ler.dev/
├── pnpm-workspace.yaml   # workspace packages (apps/*, infra/*, packages/*) + shared dep `catalog:`
├── packages/schema/      # @thai/schema — zod schemas shared by the client, the API, and the model
├── apps/web/             # @thai/web — Vite + React app, builds to apps/web/dist
├── apps/api/             # @thai/api — Hono lambdalith + async worker
└── infra/cdk/            # @thai/cdk — AWS CDK (TypeScript), run via tsx
```

## How the data layer works

The app is built around [TanStack DB](https://tanstack.com/db). Two typed collections —
`translations` and `clarifications` — are the root state; everything below them is a live
query that updates incrementally. There is no separate store, and no data fetching in
components.

Three properties fall out of that, and they are the reason for this shape:

**Every write is the same kind of thing.** `apps/web/src/db/actions.ts` is the entire
write vocabulary, and each function is a plain state update wrapped in `mutate()`.
Nothing in the client knows that a translation involves a model call.

**Server work is derived, not requested.** The client sets `status: 'pending'` on a row.
`POST /api/mutations` commits the batch, then looks at what landed in `pending` and
async-invokes the worker. So there is one write endpoint, no job concept, and retry is
just setting `status` back to `pending`.

**Progress lives on the row, not in React.** A translation that was still running when
you closed the tab is still running when you reopen it, because `status`/`error` are
synced fields. That is also what makes the offline story work at all.

Offline is three separate mechanisms, and all three are needed:

| | Mechanism |
| --- | --- |
| Durable **writes** | `@tanstack/offline-transactions` — an IndexedDB outbox written *before* dispatch, drained FIFO with exponential backoff |
| Durable **reads** | the TanStack Query persister over IndexedDB — query collections are backed by a `QueryObserver`, so a restored cache seeds the collections themselves |
| The **app shell** | a `vite-plugin-pwa` service worker. Persisting data offline is only half of it; without this, a reload with no connection never boots the app that would read the cache |

Only the leader tab owns the outbox; other tabs are online-only. The header indicator says
which you are looking at rather than hiding it.

## Prerequisites

- Node >= 22
- pnpm via corepack: `corepack enable`
- AWS CLI

## Getting started

```
pnpm install
pnpm dev
```

`pnpm dev` proxies `/api/*` to the deployed API (`vite.config.ts`), so the UI runs locally
against real data with no local DynamoDB to stand up. In production that same path is a
CloudFront behavior on this distribution — the API is always same-origin, which is why the
client has no base URL and mutations never trigger a CORS preflight.

## Scripts

| Script      | Description                                       |
| ----------- | ------------------------------------------------- |
| `dev`       | Run the web app locally                           |
| `build`     | Build all packages                                |
| `typecheck` | Type-check all packages                           |
| `lint`      | Lint the repo with oxlint and stylelint           |
| `lint:fix`  | Apply the autofixable lint fixes                  |
| `synth`     | Synthesize the CDK app                            |
| `deploy`    | Deploy the CDK app — prefer naming the stack (below) |

## Frontend

`apps/web` styles with CSS Modules over a two-layer token system:

- `src/styles/primitives.css` imports [Radix Colors](https://www.radix-ui.com/colors) directly.
  Dark mode is Radix's `.dark` class, set from `prefers-color-scheme` by an inline script in
  `index.html` so it lands before first paint.
- `src/styles/tokens.css` aliases those scales to semantic names (`--color-text`,
  `--color-border`) alongside the spacing, radius, type and motion scales. Components reference
  only this layer.

Two things are enforced rather than documented: CSS Module class names are type-checked
(`@css-modules-kit` generates `.d.ts` during `typecheck`/`build`, so `styles.typo` fails to
compile), and stylelint rejects raw hex/rgb/hsl on colour properties and raw px on spacing and
radius properties in any `*.module.css`. Hairline `border` widths stay literal px. See
`CLAUDE.md` for the full conventions.

## Dependency versions

Shared dependency versions live in the `catalog:` block of `pnpm-workspace.yaml`. Packages reference them as `"catalog:"` instead of a pinned version, so bumping a shared dependency is a one-line change in the catalog rather than an edit in every package.

## Infrastructure

`ThaiLerDevSiteStack` (AWS CDK, `us-east-1`) provisions:

- A private S3 bucket for the built site
- CloudFront in front of it, reached only via Origin Access Control
- An ACM certificate in `us-east-1` for the CloudFront distribution
- Route53 alias records pointing `thai.ler.dev` at CloudFront
- A cache-control split: hashed assets are cached immutably for a year; HTML is served `no-cache` and CloudFront is invalidated on every deploy
- A CloudFront Function on the default behavior that rewrites extensionless paths to
  `/index.html` for client-side routing
- The API (`lib/api.ts`): one DynamoDB table, the request-path Lambda, and the worker

Cost at idle is zero: there is no API Gateway (the request Lambda is reached through a
function URL behind CloudFront), DynamoDB is on-demand, and nothing else runs.

Two details that are easy to get wrong and are deliberate:

- The SPA fallback is a CloudFront Function, **not** distribution-wide `errorResponses`.
  Custom error responses apply to every behavior, so a 403 or 404 from `/api/*` would be
  rewritten to the HTML shell with status 200.
- The `/api/*` origin request policy **excludes** the `authorization` header. Origin
  access control signs each origin request with SigV4 and writes its own `Authorization`,
  so a viewer-supplied one collides with it. Auth tokens travel in `x-id-token`.

`ThaiLerDevGithubOidcStack` sets up a GitHub OIDC provider and the `thai-ler-dev-github-deploy` IAM role that CI assumes.

## Deploying

CI deploys `ThaiLerDevSiteStack` automatically on every push to `main` (see `.github/workflows/deploy.yml`).

To deploy manually:

```
aws sso login --profile admin
pnpm build
AWS_PROFILE=admin pnpm --filter cdk exec cdk deploy ThaiLerDevSiteStack
```

## One-time setup

Already done:

- CDK bootstrap in `us-east-1`
- `AWS_PROFILE=admin pnpm --filter cdk exec cdk deploy ThaiLerDevGithubOidcStack`
- `gh variable set AWS_DEPLOY_ROLE_ARN --body arn:aws:iam::063257577013:role/thai-ler-dev-github-deploy`
- The Anthropic API key in the Secrets Manager secret `thai-ler-dev/anthropic`, read at cold
  start and deliberately never in CDK source or a Lambda environment variable.

To rotate the key:

```
AWS_PROFILE=admin aws secretsmanager put-secret-value \
  --secret-id thai-ler-dev/anthropic \
  --secret-string 'sk-ant-...' \
  --region us-east-1
```

If the secret is missing or wrong, translations come back `failed` with a Secrets Manager
error; the rest of the app (sync, offline, storage) keeps working.

## Auth

Not built yet, but the seams are in place so adding it is additive:

- `apps/api/src/auth.ts` — `getUserId()` is the only place the API learns who is calling,
  and every row is already partitioned by `pk = USER#<id>`, so no data migration.
- `apps/web/src/db/api.ts` — one `request()` wrapper is the only place a request leaves
  the app; the token gets attached there, in `x-id-token`.
- The plan is a Cognito user pool federating Google, authorization-code + PKCE, free to
  10k MAU for social-IdP users. Credentials never touch this codebase.
- Sign-out must call `clearPersistedState()` (in `db/queryClient.ts`) — clearing the
  in-memory client alone would leave one user's rows in IndexedDB on a shared device.
