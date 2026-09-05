# thai.ler.dev

An offline-first reader for Thai dialog. pnpm monorepo: `packages/schema` (`@thai/schema`,
shared zod), `apps/web` (`@thai/web`, Vite + React), `apps/api` (`@thai/api`, Hono on Lambda)
and `infra/cdk` (`@thai/cdk`, AWS CDK). See `README.md` for layout, scripts, and deploys.

## Running it locally

**`pnpm dev` proxies `/api` to the deployed site** (`apps/web/vite.config.ts`). There is no
local backend and no local DynamoDB, so local UI work reads and writes **production data**.
That is deliberate — it keeps one same-origin API path everywhere and exercises the real
request path — but know it before you start clicking.

## Conventions

- **Dependency versions live in the `catalog:` block of `pnpm-workspace.yaml`.** Package
  manifests reference them as `"catalog:"`, never a semver range. Adding a dependency means
  adding it to the catalog too. `catalogMode: prefer` nudges you when you forget.
  `minimumReleaseAgeExclude` in the same file is appended by pnpm on install, not
  hand-maintained — new entries there are expected.
- **`erasableSyntaxOnly` is on** — no `enum`, no constructor parameter properties
  (`constructor(private x: T)`). Assign fields in the body instead.
- **`verbatimModuleSyntax` is on** — type-only imports need `import type`.
- Per-package tsconfigs extend `../../tsconfig.base.json` and set only what differs. A new
  package needs a `references` entry in the **root** `tsconfig.json`; that file is a solution
  file (`files: []`), so its references only mean "build these too" and carry no `composite`
  requirement — which is why it lists `packages/schema` alongside everything else.
  **Consumer** tsconfigs are the opposite: never point one at `packages/schema`. It is
  consumed as source through its exports map and typechecked as part of each consumer's
  program, so a reference there would force it to be `composite` and emit declarations that
  nothing needs. `apps/api/tsconfig.json` carries a comment saying so.
- No formatter is configured. Match the surrounding style: no semicolons, single quotes.
- `pnpm typecheck` runs repo-wide. `pnpm lint` is `oxlint && stylelint "apps/web/src/**/*.css"`
  — oxlint covers the repo, stylelint only `apps/web`. Both scripts live at the **root**;
  individual packages have no `lint` script.

## Verifying a change

There is **no test framework in this repo** — no vitest, no jest, no Playwright runner, no
`test` script anywhere. CI (`.github/workflows/deploy.yml`) runs lint → typecheck → build and
nothing else. So:

- `pnpm lint && pnpm typecheck && pnpm build` is necessary and nowhere near sufficient. It
  cannot fail for any of the behaviour this app exists for.
- **The offline paths only break in a real browser.** Drive them with the `playwright-cli`
  skill (`.claude/skills/playwright-cli/`), toggling the network with
  `page.context().setOffline(true)`. The five worth re-running after touching `src/db/` or the
  service worker: offline cold start (a hard reload with no network must still render),
  outbox drain on reconnect, optimistic rows surviving an offline reload, multi-tab leader
  election, and the failed-row retry.
- To deploy, name the stack. The root `pnpm deploy` runs `cdk deploy` with no stack argument,
  which is ambiguous across the two stacks:
  `pnpm build && AWS_PROFILE=admin pnpm --filter cdk exec cdk deploy ThaiLerDevSiteStack`.

## The data layer (read this before touching state)

The app is built around **TanStack DB**. Two collections in `apps/web/src/db/collections.ts`
are the root state; everything below is a live query.

`apps/web/src/db/` in dependency order:

| File | Responsibility |
| --- | --- |
| `api.ts` | The only place a request leaves the app. Adds the SigV4 payload hash; the auth token goes here later. |
| `queryClient.ts` | The `QueryClient`, the IndexedDB persister, and `clearPersistedState()` for sign-out. |
| `collections.ts` | The two collections, the delta merge (`mergeRows`), and `preloadState()`. |
| `sync.ts` | The outbox: `mutate()`, `hydrate()`, `onWriteError()`. |
| `actions.ts` | The write vocabulary — the only thing components call. |
| `usePendingPoll` · `useSyncStatus` · `useWriteErrors` | Poll while work is outstanding, sample outbox health, surface failed writes. |

Six rules hold the design together:

- **`actions.ts` is the only write vocabulary.** Components call those functions and nothing
  else. Never call `collection.insert/update/delete` from a component, and never add
  `onInsert`/`onUpdate`/`onDelete` handlers to the collections — that would be a second,
  non-durable write path alongside the outbox.
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
- **Only `GET /api/state` may advance the sync watermark.** `applyServerRows` in `sync.ts`
  folds a write's confirmed rows into the cache but deliberately leaves `now` where it was:
  those rows came from a write, not from a read of the whole partition, so advancing it would
  silently skip changes made on another device.

`hydrate()` also awaits `offline.waitForInit()`, so the outbox is read back off disk before
first paint; without it a reload renders a list missing the user's own unsent writes.

Two collections deliberately share one query key, so a single request fills both and they
can never disagree. `queryFn` merges the server's delta onto the previous response, because
a query collection treats what it returns as the collection's *complete* state.

**Only the leader tab owns the outbox.** Other tabs run online-only and say so in the header
indicator. That is a constraint of `@tanstack/offline-transactions`, surfaced on purpose
rather than hidden — it is not a bug to fix.

Each collection's `id` must match its entry in `COLLECTION_NAMES`
(`packages/schema/src/common.ts`). A mismatch makes `sync.ts` throw `NonRetriableError` and
silently drop every write.

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
- **Reach for a token before a literal**, but know what is actually enforced. stylelint
  rejects hex/rgb/hsl on colour properties, and raw px on spacing and radius properties. It
  does **not** reject px in `border`, `width`, `height`, or `outline` — hairline borders are
  literal px throughout the codebase and that is correct. Don't "fix" them.
- **Two token layers.** `src/styles/primitives.css` is nothing but `@import`s of Radix Colors'
  own CSS — don't copy values out of it. Components reference `src/styles/tokens.css`
  (semantic: `--color-text`, `--color-border`, `--color-accent-solid`), never a Radix primitive
  (`--mauve-11`, `--purple-9`) directly. Re-hueing the site means swapping the `@import` lines
  and the aliases in `tokens.css`; nothing else changes. Radix's step contract (1 app bg ·
  6 subtle border · 9 solid · 11 muted text · 12 strong text) holds in both themes, which is
  why the alias layer never branches on theme. Adding a hue also means adding it to
  `importFrom` in `stylelint.config.js`, or every `var()` using it fails lint.
- **Dark mode is Radix's `.dark` class**, set on `<html>` by the inline script in `index.html`
  from `prefers-color-scheme`. It runs before first paint — that's what stops the flash, so
  keep it inline and in `<head>`. Declare every semantic token under `:root`; use `.dark` only
  for overrides (stylelint's token check reads `:root`). Adding an explicit theme toggle later
  means changing that script's source of truth to `localStorage`; the CSS doesn't move.
- **Class names are type-checked.** `cmk` (`@css-modules-kit`) writes `.d.ts` into `generated/`
  during `typecheck` and `build`; the TS plugin covers the editor, so `dev` is plain `vite`.
  `styles.typo` is a compile error — don't add an index signature to work around it. The editor
  needs the workspace TypeScript (`.vscode/settings.json` sets `typescript.tsdk`). `cmk` does
  not prune, so `generated/` keeps `.d.ts` files for deleted components; it is gitignored and
  harmless.
- **Accessibility is a requirement, not a final pass.** Keyboard reachable, visible focus ring,
  correct roles and labels. oxlint's `jsx-a11y` plugin runs at `correctness: error`, so a11y
  failures break CI. Focus styling uses `:focus-visible`, never `:focus`. If you add a link to
  another site, it carries `rel="noreferrer"` and announces that it opens a new tab — there are
  none today.
- When you add an icon, make it an inline component under `src/components/icons/` with
  `fill="currentColor"` so its colour is a token. (There are none today.) Don't reintroduce a
  `public/` SVG sprite: files there are served `immutable, max-age=1yr`, so editing one in
  place is stale at the CloudFront edge for a year.
- **English only.** No i18n framework or translation layer; copy is hardcoded English and
  `<html lang="en">`.
- Routes are file-based under `src/routes/`. `src/routeTree.gen.ts` is generated by the Vite
  plugin but **committed**, because CI runs `tsc -b` before `vite build`; it is ignored by
  oxlint. Route files export both `Route` and a component, so `react/only-export-components`
  is off for that directory.
- **Vite plugin order matters.** `tanstackRouter()` must come before `react()` or generated
  route modules aren't transformed. `VitePWA` uses `injectRegister: null` because the service
  worker is registered explicitly in `main.tsx`; letting the plugin auto-inject registers twice.
- A service worker (`vite-plugin-pwa`) precaches the app shell. It is not optional polish:
  without it a reload with no connection never boots the app that would read the persisted
  cache. Files with build-stable names must stay in the `UNVERSIONED` list in `site-stack.ts`
  so they deploy `no-cache`; a service worker pinned `immutable` for a year would outlive its
  own replacement at every edge.

## packages/schema

Zod schemas shared by the client, the API, and the model. `BreakdownSchema` is handed to the
Messages API as `output_config.format` via `zodOutputFormat`, so a model response the client
cannot store is impossible by construction. Change a row shape here and both sides follow.

What a client may write is a strict subset of the stored row, enforced in
`apps/api/src/normalize.ts`: on insert, the identifying and authored fields only
(`id`, `createdAt`, `sourceText`, or a clarification's `translationId`/`lineId`/`segmentIds`/
`question`); on update, only `deleted`, `status: 'pending'` (that is what retry is), and a
clarification's `question`. Everything else — `lines`, `summary`, `answer`, `updatedAt` — is
server-owned, so a client cannot fabricate a `ready` translation or write content the model
never produced.

## apps/api

- ESM + `nodenext` like `infra/cdk`, but relative imports use `.ts` extensions (esbuild
  bundles it; only `infra/cdk` runs through `tsx`, which needs `.js`).
- `getUserId()` in `src/auth.ts` is the only place the API learns who is calling. That is the
  whole auth seam.
- **Key shapes** (`src/keys.ts`): `pk = USER#<id>`, `sk = <collection>#<id>`, idempotency
  records at `IDEMP#<key>`, and the `by-updated` LSI sorts on
  `sk2 = <16-digit zero-padded updatedAt>#<collection>#<id>`. Zero-padded so lexicographic
  order matches numeric; suffixed so same-millisecond rows stay distinct *and* so the `>`
  query in `store.ts` still returns rows whose `updatedAt` equals `since`. The LSI is
  deliberately sparse — idempotency records carry no `sk2` and stay out of it.
- **Idempotency depends on ordering.** `POST /api/mutations` writes the `IDEMP#` item under
  `attribute_not_exists` as **index 0** of the `TransactItems` array, and detects a replay by
  reading `CancellationReasons[0]`. Reorder that array and a retried outbox entry duplicates
  its rows instead of being answered from the first attempt's.
- Return a 4xx for anything permanently invalid. The client turns 4xx into a
  `NonRetriableError` and drops the entry; anything else is retried forever, and a bad
  mutation at the head of a FIFO outbox blocks every write behind it.
- The worker calls `claude-opus-5` with adaptive thinking and structured output
  (`messages.parse` + `zodOutputFormat`, reading `response.parsed_output`). Its Lambda timeout
  is 10 minutes and the SDK client's is 9 — **those two numbers must move together**, because
  the gap is what lets a timed-out call still record `status: 'failed'` instead of leaving the
  row stuck `pending`.
- The worker re-reads its row and exits unless it is still `pending`, so duplicate
  invocations (Lambda async retries, a user pressing Retry) are harmless. It is dispatched
  only when the mutation batch was not a replay, and a dispatch failure is logged rather than
  returned — the write is already committed, and Retry covers the rest.
- `/api/state` returns everything changed since `since`, tombstones included, from one Query
  against the `by-updated` LSI. The watermark is rewound a couple of seconds
  (`SYNC_WATERMARK_SKEW_MS`) so a row committed concurrently with a read is not skipped.
  Rows are re-validated on the way out and a bad one is dropped with a log rather than failing
  the sync, so a single unparseable row can't wedge a client forever.

## infra/cdk

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
- `GithubOidcStack` is deployed **locally only, never from CI** — it grants CI its own trust.
  Its trust policy must keep both the immutable and the legacy GitHub OIDC `sub` forms; this
  repo was created after 2026-07-15, so it emits the immutable one.

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
or 404 from `/api/*` would come back as the HTML shell with status 200. The function only
rewrites URIs containing no `.`, so a genuinely missing asset still 404s.

## AWS

Local access is SSO: `aws sso login --profile admin`, then prefix commands with
`AWS_PROFILE=admin`. Account `063257577013`.

CI (`.github/workflows/deploy.yml`) deploys `ThaiLerDevSiteStack` on push to `main` via OIDC,
assuming the role in the repo variable `AWS_DEPLOY_ROLE_ARN`.

The Anthropic API key lives in the Secrets Manager secret `thai-ler-dev/anthropic`, created
out of band and imported by name — never in CDK source or a Lambda environment variable.
