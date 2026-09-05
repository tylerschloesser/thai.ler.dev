---
paths:
  - "apps/web/src/**/*.ts"
  - "apps/web/src/**/*.tsx"
---

# The web data layer (read this before touching state)

Loaded when you touch any TypeScript under `apps/web/src/`. Components are included on
purpose: most of these rules are about what a component may and may not do.

The app is built around **TanStack DB**. Two collections in `src/db/collections.ts` are the
root state; everything below is a live query. `README.md` explains why; this is what holds.

`src/db/` in dependency order:

| File | Responsibility |
| --- | --- |
| `api.ts` | The only place a request leaves the app. Adds the SigV4 payload hash (`.claude/rules/cdk.md`, gotcha 2); the auth token goes here later. |
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

## Verifying a change here

Lint, typecheck and build cannot fail for any of the above. Two things do, and neither
subsumes the other. After touching `src/db/`, the route loaders, or the service worker config
in `vite.config.ts`, run both.

`pnpm test:e2e` (`.claude/rules/testing.md`) covers the offline cold start, an offline write
queuing, the outbox draining on reconnect, leader election, and the failed-row retry. CI runs
it on every PR.

The `verify-offline` skill covers the rest, in a real browser: Playwright's `setOffline` is
not a real network drop. Note that its **check 2 fails today on
[#1](https://github.com/tylerschloesser/thai.ler.dev/issues/1)** — that is the app, not the
walk. Issues [#1](https://github.com/tylerschloesser/thai.ler.dev/issues/1) and
[#2](https://github.com/tylerschloesser/thai.ler.dev/issues/2) say what neither covers today:
a second offline reload comes back empty, and a finished row never reaches the home list.
