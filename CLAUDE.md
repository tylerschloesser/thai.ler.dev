# thai.ler.dev

pnpm monorepo: `apps/web` (`@thai/web`, Vite + React) and `infra/cdk` (`@thai/cdk`, AWS CDK).
See `README.md` for layout, scripts, and deploy instructions.

## Conventions

- **Dependency versions live in the `catalog:` block of `pnpm-workspace.yaml`.** Package
  manifests reference them as `"catalog:"`, never a semver range. Adding a dependency means
  adding it to the catalog too.
- **`erasableSyntaxOnly` is on** — no `enum`, no constructor parameter properties
  (`constructor(private x: T)`). Assign fields in the body instead.
- **`verbatimModuleSyntax` is on** — type-only imports need `import type`.
- Per-package tsconfigs extend `../../tsconfig.base.json` and set only what differs. A new
  package also needs a `references` entry in the root `tsconfig.json`.
- No formatter is configured. Match the surrounding style: no semicolons, single quotes.
- `pnpm typecheck` and `pnpm lint` (oxlint, `.oxlintrc.json`) both run repo-wide.

## infra/cdk

- ESM + `nodenext`: relative imports use `.js` extensions even though the sources are `.ts`
  (`import { SiteStack } from '../lib/site-stack.js'`). The app runs through `tsx`.
- Everything is in **us-east-1** — CloudFront requires its ACM certificate there. `env` is set
  explicitly in `bin/app.ts` because the `admin` profile has no default region.
- `SiteStack` reads `apps/web/dist` and throws if it's missing, so run `pnpm build` before
  `cdk synth` or `cdk deploy`.
- `GithubOidcStack` is deployed **locally only, never from CI** — it grants CI its own trust.
  Its trust policy must keep both the immutable and the legacy GitHub OIDC `sub` forms; this
  repo was created after 2026-07-15, so it emits the immutable one.

## AWS

Local access is SSO: `aws sso login --profile admin`, then prefix commands with
`AWS_PROFILE=admin`. Account `063257577013`.

CI (`.github/workflows/deploy.yml`) deploys `ThaiLerDevSiteStack` on push to `main` via OIDC.
