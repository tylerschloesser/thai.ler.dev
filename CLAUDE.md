# thai.ler.dev

An offline-first reader for Thai dialog. pnpm monorepo: `packages/schema` (`@thai/schema`,
shared zod), `apps/web` (`@thai/web`, Vite + React), `apps/api` (`@thai/api`, Hono on Lambda)
and `infra/cdk` (`@thai/cdk`, AWS CDK). See `README.md` for layout, scripts, and deploys.

## Conventions

- **Dependency versions live in the `catalog:` block of `pnpm-workspace.yaml`.** Package
  manifests reference them as `"catalog:"`, never a semver range. Adding a dependency means
  adding it to the catalog too.
- **`erasableSyntaxOnly` is on** — no `enum`, no constructor parameter properties
  (`constructor(private x: T)`). Assign fields in the body instead.
- **`verbatimModuleSyntax` is on** — type-only imports need `import type`.
- Per-package tsconfigs extend `../../tsconfig.base.json` and set only what differs. A new
  package also needs a `references` entry in the root `tsconfig.json`. Do **not** add a
  `references` entry pointing at `packages/schema` — it is consumed as source through its
  exports map and typechecked as part of each consumer's program; a project reference would
  force it to be `composite` and emit declarations, which nothing needs.
- No formatter is configured. Match the surrounding style: no semicolons, single quotes.
- `pnpm typecheck` and `pnpm lint` (oxlint, `.oxlintrc.json`) both run repo-wide.

## The data layer (read this before touching state)

The app is built around **TanStack DB**. Two collections in `apps/web/src/db/collections.ts`
are the root state; everything below is a live query. Five rules hold the design together:

- **`apps/web/src/db/actions.ts` is the only write vocabulary.** Components call those
  functions and nothing else. Never call `collection.insert/update/delete` from a component,
  and never add `onInsert`/`onUpdate`/`onDelete` handlers to the collections — that would be
  a second, non-durable write path alongside the outbox.
- **Writes return `void`, and nothing awaits them.** `mutate()` applies optimistic state
  synchronously, then commits in the background. The commit promise only settles when the
  *server* confirms, which offline is never — awaiting it would disable a button until the
  network came back, for a change that is already saved and on screen. Failures arrive via
  `onWriteError` and surface as a toast.
- **Progress lives on the row, not in React.** `status` (`pending`/`ready`/`failed`) and
  `error` are synced fields. That is what survives a reload, and what makes retry a plain
  state update rather than a special case. Don't add a `useState` loading flag for anything
  the server does.
- **Server-side work is derived, never requested.** The client sets `status: 'pending'`;
  `POST /api/mutations` inspects what landed in that state and invokes the worker. There is
  one write endpoint. Adding a `/api/translate` route would break the whole model.
- **Cached data outranks a load error.** Offline, refreshes always fail while the persisted
  cache still holds everything worth reading, so check `data.length` *before* `isError`.
  Route loaders (`hydrate()`) swallow preload failures for the same reason — a loader is an
  optimization, not a correctness gate.

`hydrate()` also awaits `offline.waitForInit()`, so the outbox is read back off disk before
first paint; without it a reload renders a list missing the user's own unsent writes.

Two collections deliberately share one query key, so a single request fills both and they
can never disagree. `queryFn` merges the server's delta onto the previous response, because
a query collection treats what it returns as the collection's *complete* state.

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
- Routes are file-based under `src/routes/`. `src/routeTree.gen.ts` is generated by the Vite
  plugin but **committed**, because CI runs `tsc -b` before `vite build`; it is ignored by
  oxlint. Route files export both `Route` and a component, so `react/only-export-components`
  is off for that directory.
- A service worker (`vite-plugin-pwa`) precaches the app shell. It is not optional polish:
  without it a reload with no connection never boots the app that would read the persisted
  cache. Files with build-stable names — `sw.js`, `manifest.webmanifest`, `*.html` — must
  stay in `UNVERSIONED` in `site-stack.ts` so they are deployed `no-cache`; a service worker
  pinned `immutable` for a year would outlive its own replacement at every edge.

## packages/schema

Zod schemas shared by the client, the API, and the model. `BreakdownSchema` is handed to the
Messages API as `output_config.format` via `zodOutputFormat`, so a model response the client
cannot store is impossible by construction. Change a row shape here and both sides follow.

Client-supplied fields are a strict subset of the stored row (see `apps/api/src/normalize.ts`):
a client may set `sourceText` and ask for `status: 'pending'`, and nothing else. It cannot
fabricate a `ready` translation or write content the model never produced.

## apps/api

- ESM + `nodenext` like `infra/cdk`, but relative imports use `.ts` extensions (esbuild
  bundles it; only `infra/cdk` runs through `tsx`, which needs `.js`).
- `getUserId()` in `src/auth.ts` is the only place the API learns who is calling, and every
  key is `pk = USER#<id>`. That is the whole auth seam.
- Return a 4xx for anything permanently invalid. The client turns 4xx into a
  `NonRetriableError` and drops the entry; anything else is retried forever, and a bad
  mutation at the head of a FIFO outbox blocks every write behind it.
- The worker re-reads its row and exits unless it is still `pending`, so duplicate
  invocations (Lambda async retries, a user pressing Retry) are harmless.
- `/api/state` returns everything changed since `since`, tombstones included, from one Query
  against the `by-updated` LSI. The watermark is rewound a couple of seconds
  (`SYNC_WATERMARK_SKEW_MS`) so a row committed concurrently with a read is not skipped.

## infra/cdk

- ESM + `nodenext`: relative imports use `.js` extensions even though the sources are `.ts`
  (`import { SiteStack } from '../lib/site-stack.js'`). The app runs through `tsx`.
- Everything is in **us-east-1** — CloudFront requires its ACM certificate there. `env` is set
  explicitly in `bin/app.ts` because the `admin` profile has no default region.
- `SiteStack` reads `apps/web/dist` and throws if it's missing, so run `pnpm build` before
  `cdk synth` or `cdk deploy`.
- `esbuild` is a **root** devDependency, not `infra/cdk`'s: `NodejsFunction` runs the bundler
  from the workspace root (where the lockfile is), so that is where the binary must resolve.
  Without it CDK silently falls back to Docker bundling.
- The API is in `SiteStack`, not its own stack: `FunctionUrlOrigin.withOriginAccessControl`
  adds a resource policy scoped to the distribution's ARN, so splitting them is a cycle.

### Three CloudFront gotchas that each cost a debugging session

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
or 404 from `/api/*` would come back as the HTML shell with status 200.
- `GithubOidcStack` is deployed **locally only, never from CI** — it grants CI its own trust.
  Its trust policy must keep both the immutable and the legacy GitHub OIDC `sub` forms; this
  repo was created after 2026-07-15, so it emits the immutable one.

## AWS

Local access is SSO: `aws sso login --profile admin`, then prefix commands with
`AWS_PROFILE=admin`. Account `063257577013`.

CI (`.github/workflows/deploy.yml`) deploys `ThaiLerDevSiteStack` on push to `main` via OIDC.

The Anthropic API key lives in the Secrets Manager secret `thai-ler-dev/anthropic`, created
out of band and imported by name — never in CDK source or a Lambda environment variable.
