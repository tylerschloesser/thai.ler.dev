---
paths:
  - "**/tsconfig*.json"
  - "**/package.json"
  - "pnpm-workspace.yaml"
---

# TypeScript project layout and the dependency catalog

Loaded when you touch a `tsconfig*.json`, a `package.json`, or `pnpm-workspace.yaml`.

- **Dependency versions live in the `catalog:` block of `pnpm-workspace.yaml`.** Package
  manifests reference them as `"catalog:"`, never a semver range. Adding a dependency means
  adding it to the catalog too. `catalogMode: prefer` nudges you when you forget.
  `minimumReleaseAgeExclude` in the same file is appended by pnpm on install, not
  hand-maintained — new entries there are expected.
- Per-package tsconfigs extend `../../tsconfig.base.json` and set only what differs. A new
  package needs a `references` entry in the **root** `tsconfig.json`; that file is a solution
  file (`files: []`), so its references only mean "build these too" and carry no `composite`
  requirement — which is why it lists `packages/schema` alongside everything else.
  **Consumer** tsconfigs are the opposite: never point one at `packages/schema`. It is
  consumed as source through its exports map and typechecked as part of each consumer's
  program, so a reference there would force it to be `composite` and emit declarations that
  nothing needs. `apps/api/tsconfig.json` carries a comment saying so.
- `pnpm typecheck` runs repo-wide. `pnpm lint` is `oxlint && stylelint "apps/web/src/**/*.css"`
  — oxlint covers the repo, stylelint only `apps/web`. Both scripts live at the **root**;
  individual packages have no `lint` script.
- `esbuild` is a **root** devDependency on purpose; the root `package.json` `"//"` key says
  why, and `.claude/rules/cdk.md` has the consequence.
