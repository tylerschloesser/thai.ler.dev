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

## apps/web

- **Always check the current Base UI docs before writing a component** —
  <https://base-ui.com> (component list, `render` prop, data attributes, `useRender`). Do not
  write Base UI from memory: the package was renamed from `@base-ui-components/react` to
  **`@base-ui/react`** and went 1.0 in Dec 2025, so anything older is wrong about both the
  import path and the API. Check the installed version's `exports` before assuming a component
  exists.
- **Use a Base UI component when one exists; fall back to native HTML otherwise.** Don't reach
  for Base UI where semantic HTML is already correct — nav links are `<ul>`/`<a>`, and
  decorative rules are CSS borders, not `Separator`.
- **Styling is CSS Modules only** (`X.module.css` next to `X.tsx`). No global stylesheets
  outside `src/styles/`, no inline `style` for anything themeable. Class names are camelCase,
  because they're read as `styles.someClass`.
- **Every value in a `.module.css` must be a token** — `var(--color-*)`, `var(--space-*)`,
  `var(--radius-*)`, `var(--text-*)`. Raw hex and raw px are blocked by stylelint outside
  `src/styles/`. Genuine exceptions (optical alignment in artwork) need an explicit
  `stylelint-disable-next-line` with a reason.
- **Two token layers.** `src/styles/primitives.css` is nothing but `@import`s of Radix Colors'
  own CSS — don't copy values out of it. Components reference `src/styles/tokens.css`
  (semantic: `--color-text`, `--color-border`, `--color-accent-solid`), never a Radix primitive
  (`--mauve-11`, `--purple-9`) directly. Re-hueing the site means swapping the `@import` lines
  and the aliases in `tokens.css`; nothing else changes. Radix's step contract (1 app bg ·
  6 subtle border · 9 solid · 11 muted text · 12 strong text) holds in both themes, which is
  why the alias layer never branches on theme.
- **Dark mode is Radix's `.dark` class**, set on `<html>` by the inline script in `index.html`
  from `prefers-color-scheme`. It runs before first paint — that's what stops the flash, so
  keep it inline and in `<head>`. Declare every semantic token under `:root`; use `.dark` only
  for overrides (stylelint's token check reads `:root`). Adding an explicit theme toggle later
  means changing that script's source of truth to `localStorage`; the CSS doesn't move.
- **Class names are type-checked.** `cmk` (`@css-modules-kit`) writes `.d.ts` into `generated/`
  during `typecheck` and `build`; the TS plugin covers the editor, so `dev` is plain `vite`.
  `styles.typo` is a compile error — don't add an index signature to work around it. The editor
  needs the workspace TypeScript (`.vscode/settings.json` sets `typescript.tsdk`).
- **Accessibility is a requirement, not a final pass.** Keyboard reachable, visible focus ring,
  correct roles and labels; external links carry `rel="noreferrer"` and announce that they open
  a new tab. oxlint's `jsx-a11y` plugin runs at `correctness: error`, so a11y failures break CI.
  Focus styling uses `:focus-visible`, never `:focus`.
- Icons are inline components in `src/components/icons/` using `fill="currentColor"` so their
  color is a token. Don't reintroduce a `public/` SVG sprite: files there are served
  `immutable, max-age=1yr`, so editing one in place is stale at the CloudFront edge for a year.
- **English only.** No i18n framework or translation layer; copy is hardcoded English and
  `<html lang="en">`.
- `pnpm lint` runs oxlint *and* stylelint (`stylelint.config.js`); `pnpm lint:fix` autofixes
  both, which is also how CSS gets formatted since there's no formatter.

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
