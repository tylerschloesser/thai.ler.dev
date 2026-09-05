# thai.ler.dev

Source for https://thai.ler.dev.

## Layout

```
thai.ler.dev/
├── pnpm-workspace.yaml   # workspace packages (apps/*, infra/*) + shared dep `catalog:`
├── apps/web/             # @thai/web — Vite + React app, builds to apps/web/dist
└── infra/cdk/            # @thai/cdk — AWS CDK (TypeScript), run via tsx
```

## Prerequisites

- Node >= 22
- pnpm via corepack: `corepack enable`
- AWS CLI

## Getting started

```
pnpm install
pnpm dev
```

## Scripts

| Script      | Description                                       |
| ----------- | ------------------------------------------------- |
| `dev`       | Run the web app locally                           |
| `build`     | Build all packages                                |
| `typecheck` | Type-check all packages                           |
| `lint`      | Lint the repo with oxlint and stylelint           |
| `lint:fix`  | Apply the autofixable lint fixes                  |
| `synth`     | Synthesize the CDK app                            |
| `deploy`    | Deploy the CDK app                                |

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
compile), and stylelint rejects raw hex or px values in any `*.module.css` — values there must
be tokens. See `CLAUDE.md` for the full conventions.

## Dependency versions

Shared dependency versions live in the `catalog:` block of `pnpm-workspace.yaml`. Packages reference them as `"catalog:"` instead of a pinned version, so bumping a shared dependency is a one-line change in the catalog rather than an edit in every package.

## Infrastructure

`ThaiLerDevSiteStack` (AWS CDK, `us-east-1`) provisions:

- A private S3 bucket for the built site
- CloudFront in front of it, reached only via Origin Access Control
- An ACM certificate in `us-east-1` for the CloudFront distribution
- Route53 alias records pointing `thai.ler.dev` at CloudFront
- A cache-control split: hashed assets are cached immutably for a year; HTML is served `no-cache` and CloudFront is invalidated on every deploy

`ThaiLerDevGithubOidcStack` sets up a GitHub OIDC provider and the `thai-ler-dev-github-deploy` IAM role that CI assumes.

## Deploying

CI deploys `ThaiLerDevSiteStack` automatically on every push to `main` (see `.github/workflows/deploy.yml`).

To deploy manually:

```
aws sso login --profile admin
pnpm build
AWS_PROFILE=admin pnpm --filter cdk exec cdk deploy ThaiLerDevSiteStack
```

## One-time setup (already done)

- CDK bootstrap in `us-east-1`
- `AWS_PROFILE=admin pnpm --filter cdk exec cdk deploy ThaiLerDevGithubOidcStack`
- `gh variable set AWS_DEPLOY_ROLE_ARN --body arn:aws:iam::063257577013:role/thai-ler-dev-github-deploy`
