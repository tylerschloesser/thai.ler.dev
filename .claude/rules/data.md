---
paths:
  - 'src/db/**'
  - 'src/lib/**'
  - 'src/sync/**'
---

# Data layer rules

Data layer lives at `src/db/` (`db.ts`, `repo.ts`, `snapshot.ts`,
`settings.ts`, `meta.ts`) plus pure helpers in `src/lib/` and the client
sync loop in `src/sync/`. `src/lib/records.ts` (pure types, no Dexie) is
the **shared record contract** with `api/**` (PLAN.MD §4.4): `Base`,
`Dialogue`, `AnnotationRecord`/`AnnotationRun`/`RUN_STATES`/`RUN_PROVIDERS`/
`LEGACY_RUN`, `SettingRow`, `RecordKind`/`RECORD_KINDS`, `Manifest`/
`ManifestEntry`/`manifestKey`/`emptyManifest`. `src/db/db.ts` re-exports all
of it so every existing `from '../db/db'` import keeps working unchanged —
`api/**` imports these types from `src/lib`, never from `src/db`. `src/lib/
merge.ts` (`pickWinner`, `mergeSettingRows`, `settingsUpdatedAt`) is the
other shared module: the same last-writer-wins rule backs both the client's
`repo.mergeRemote*`/`snapshot.ts` merges and the server's `PUT
/api/sync/record`.

## Repo-only writes

`src/db/repo.ts` is the **only** write path to Dexie tables. Components and
hooks call repo functions (`createDialogue`, `renameDialogue`,
`softDeleteDialogue`, `listDialogues` (live), `getDialogue`, `getAnnotation`,
`getAnnotationsByIds` (batched, for list rendering), `setCurrentAnnotation`,
`mergeRemoteDialogue`/`mergeRemoteAnnotation`/`mergeRemoteSettings`) — never
`db.table.put/add/delete` directly outside `repo.ts`. Every write bumps
`updatedAt`. Settings (`src/db/settings.ts`) are the one exception:
single-key rows with defaults, not soft-deletable records, so they own
their own `getSetting`/`setSetting`/`useSetting` API instead of living in
`repo.ts` — but `setSetting` still calls `repo.enqueueOutbox` in the same
transaction, same as every other write path.

## Client-owned vs. server-owned records

As of M3, annotation runs entirely server-side (`api/_lib/runner.ts`) — the
browser-side pipeline (`src/llm/pipeline.ts`, `createAnnotation`/
`upsertAnnotationLine`/`finalizeAnnotation`) is gone, and no local write path
builds an `AnnotationRecord` line-by-line anymore. Records now split into two
kinds:

- **Client-owned** (`dialogues`, `settings`): written locally first (by a
  repo function or `setSetting`), enqueued to the `outbox` in the same
  transaction, and pushed to the server by `src/sync/push.ts`.
- **Server-owned** (`annotations`): created and updated only by the runner
  (`POST /api/annotate` creates the record with `run.state: 'queued'`; the
  runner writes every subsequent line/state change). The browser never
  writes an `AnnotationRecord` directly — it only ever receives one, via
  `POST /api/annotate`'s response, `GET /api/annotation` polling
  (`src/sync/poll.ts`), or a pull, and merges it in through
  `repo.mergeRemoteAnnotation`.

`mergeRemoteDialogue`/`mergeRemoteAnnotation`/`mergeRemoteSettings` are the
**only** entry point for a remote record into local storage, for both kinds
— see the outbox invariants below for why they never themselves enqueue.

## Schema (Dexie v2, `src/db/db.ts`)

```ts
interface AnnotationRun {
  state: 'queued' | 'running' | 'done' | 'cancelled'
  provider: 'anthropic' | 'fake' | 'fake-slow'
  leaseUntil: string | null
  hops: number
  steps: number
  lastError: string | null
}
interface AnnotationRecord extends Base {
  dialogueId: string
  model: string
  promptVersion: number
  schemaVersion: number
  lines: Array<LineAnnotation | null>
  lineErrors: Array<string | null>
  status: 'partial' | 'complete'
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number }
  durationMs: number
  run: AnnotationRun
}
interface OutboxRow {
  key: string // `${kind}:${id}`, e.g. `dialogue:<id>` or `settings:all`
  kind: 'dialogue' | 'annotation' | 'settings'
  id: string
  updatedAt: string
  rev: string // fresh newId() per enqueue; not indexed, see below
}
```

Tables: `dialogues: id, updatedAt, deletedAt`, `annotations: id, dialogueId,
updatedAt`, `settings: key`, `meta: key`, `outbox: key, updatedAt` — `rev`
is a plain (unindexed) field, added without a schema/version bump since it
isn't part of the store definition.
`DB_SCHEMA_VERSION = 2`'s `.upgrade()` stamps `run: { ...LEGACY_RUN }`
(`state: 'done', provider: 'anthropic'`, everything else zero/null — a P0
record was always a synchronous, already-finished browser run) onto every
pre-existing `annotations` row; the new `outbox` table starts empty. `meta`
gained two keys: `lastPullAt` (ISO string, `src/db/meta.ts`'s
`getLastPullAt`/`setLastPullAt`) and `syncInitialized` (`'1'` once
`src/sync/index.ts`'s one-time "enqueue everything" migration has run).
Annotations are a separate table from dialogues so that reading a
`Dialogue` for the title/sourceText/list view never touches the `lines`
blob. The library's per-row status chip is the one place that still needs
an `AnnotationRecord` (for `status`/`lineErrors`) — IndexedDB always
deserializes a full record, so that read can't avoid the blob, but
`DialogueList.tsx` pays that cost once via a single batched
`getAnnotationsByIds`, not once per row.

## Migration rule

Any schema change bumps the Dexie version number and adds a `.upgrade()`
callback — never mutate an existing versioned schema in place. Bump
`meta.schemaVersion` (via `DB_SCHEMA_VERSION`) alongside it.

## Sync-readiness invariants

Every record: `id` is a UUID (`src/lib/ids.ts`'s `newId`, currently
`crypto.randomUUID()`); timestamps are ISO-8601 strings; deletes are soft
(`deletedAt`), queries filter `deletedAt === null`; every write sets
`updatedAt`. `deviceId` is **not** stamped on individual records — it's a
single value in the `meta` table (`getDeviceId()`, `src/db/meta.ts`),
included once per `Snapshot` (see below) for future multi-device sync, not
per-row. Hard-purge tombstones older than 90 days on startup
(`purgeTombstones` in `db.ts`, called fire-and-forget from
`src/app/debug.ts`): in the same transaction as the `bulkDelete` of each
stale `dialogues`/`annotations` row, it also `bulkDelete`s that record's
`outbox` row (by `manifestKey(kind, id)`) if one is still queued — a
hard-purged record must never resurrect itself by pushing a stale write for
an id the server (and every other device) has already forgotten.

## Outbox invariants (`repo.ts`'s `enqueueOutbox`/`takeOutbox`/`clearOutbox`)

- **Every repo write enqueues in the same Dexie transaction as the write it
  records** — `createDialogue`, `renameDialogue`, `softDeleteDialogue`,
  `setCurrentAnnotation`, `settings.ts`'s `setSetting`, and
  `snapshot.ts`'s `importSnapshot` (for every record the merge actually
  changed) all pass `db.outbox` to `db.transaction(...)` alongside the
  table(s) they write, so a write and its outbox row can never diverge.
  `enqueueOutbox` uses `put`, so repeated writes to the same key before
  it's drained coalesce into one row with the latest `updatedAt` — but a
  fresh `rev` (`newId()`) on every call, never reused.
- `clearOutbox(key, rev)` is compare-and-delete keyed on **`rev`, not
  `updatedAt`**: it only removes the row if its stored `rev` still matches
  what the caller last saw. If a newer local write landed while a push for
  that row was in flight, `enqueueOutbox` already overwrote the row with a
  fresh `rev`, so the delete is a no-op and the row stays queued for the
  next push. `rev` exists specifically because two writes to the same
  record can share an `updatedAt` (e.g. a create immediately followed by a
  rename, same millisecond) — keying the compare-and-delete on `updatedAt`
  would then let a push racing the second write delete it using the first
  write's now-stale `updatedAt`, silently dropping the second write. `rev`
  is not part of the `outbox` index (`key, updatedAt`), so this needed no
  Dexie version bump.
- **`mergeRemoteDialogue`/`mergeRemoteAnnotation`/`mergeRemoteSettings`
  never enqueue.** An incoming remote record (from `src/sync/pull.ts` or
  the winner of a `src/sync/push.ts` PUT) is not a local change; echoing it
  back to the outbox would loop forever. They apply `pickWinner`/
  `mergeSettingRows` (`src/lib/merge.ts`) exactly like the server does, and
  return whichever side actually won so the caller knows what's now stored.

## Snapshot format v2 — internal seeding/debug format (`src/db/snapshot.ts`)

Tyler doesn't want an import/export feature (dropped 2026-09-13, PLAN.MD
§10) — there is no user-facing Export/Import UI anywhere in the app. The
`Snapshot` shape below is purely internal now: it's the sync payload shape,
used by `window.__thai.{exportSnapshot,importSnapshot}` (`src/app/debug.ts`)
for e2e seeding (`e2e/fixtures.ts`'s `seed`) and ad hoc debugging in the
browser console — never surfaced through any component.

```ts
interface Snapshot {
  format: 'thai.ler.dev/snapshot'
  schemaVersion: number
  exportedAt: string
  deviceId: string
  dialogues: Dialogue[]
  annotations: AnnotationRecord[]
  settings: SettingRow[]
}
```

`schemaVersion` is `2` on every export (`AnnotationRecord` includes `run`).
`mergeSnapshot(local, incoming)`/`importSnapshot(incoming)` both refuse an
`incoming` snapshot whose `format` isn't `SNAPSHOT_FORMAT` or whose
`schemaVersion` isn't the current `DB_SCHEMA_VERSION`, with a readable
error — there is no upgrade path from an older `schemaVersion` (that
existed only to import pre-M1/M2 P0 export files, which is no longer a
supported flow). Every snapshot fed into these two functions — from
`exportSnapshot()` itself, e2e fixtures, or a hand-written test snapshot —
is expected to already be at the current shape. Merging itself is
last-writer-wins per record by `updatedAt` via `pickWinner`, with
tombstones winning ties (settings merge per-key via `mergeSettingRows`, no
tombstone concept). Import (`importSnapshot`) always merges — it never
wipes local data — and enqueues an outbox row for every record the merge
actually added or changed (not for records it skipped), so a seeded
library gets pushed on the next sync. Unit-test LWW, tombstone resurrection
prevention, and the unsupported-format/schemaVersion refusal.

## Client sync (`src/sync/`)

- `api.ts`: `createApi(fetchImpl)` builds a `SyncApi` (typed wrappers for
  every `/api/sync/*` + `/api/annotat*` route); a non-2xx response throws
  `ApiError(kind, message, status)`, and a `fetch` throw itself (offline,
  DNS, CORS) is normalized to `ApiError('offline', ...)` so callers never
  need a separate "no network" branch. `api` is the default instance bound
  to the global `fetch`; every function below takes an optional injected
  `api` for tests (and, in `scripts/sync-integration.test.ts`, an in-process
  handler router instead of a real `fetch`).
- `pull.ts`: manifest → diff each entry against the local record via
  `shouldPull`, which mirrors `pickWinner`'s LWW-plus-tie-break exactly
  (not just a plain timestamp comparison): pull when the entry is strictly
  newer, or when it **ties** the local `updatedAt` and the entry is a
  tombstone (`deletedAt !== null`) while local isn't — otherwise skip.
  Settings entries never carry a tombstone (`toManifestEntry` always sets
  `deletedAt: null` for `kind: 'settings'`), so for them this reduces to
  the original plain `>` comparison against `settingsUpdatedAt(local
rows)`. Whatever changed is fetched and merged via `repo.mergeRemote*`,
  then `meta.lastPullAt` is stamped.
- `push.ts`: drains the outbox — for each row, load the current local
  record, `PUT` it, `mergeRemoteWinner` the server's LWW winner back in
  (never re-enqueues), then `clearOutbox`. A failed `PUT` (anything but
  `'offline'`) leaves that row queued and keeps draining the rest; an
  `'offline'` failure stops draining immediately.
- `poll.ts`: `watchAnnotation(id)` polls `GET /api/annotation` every 4s
  while a run is active, merging every response in; if the lease looks
  stalled (`leaseUntil` more than 15s in the past) and lines remain, it
  calls `POST /api/annotation/resume` at most once a minute. Stops itself
  only once `isTerminal(run, now)` — exported for `DialogueView`'s own
  resume-on-open watch effect to share the exact same rule — is true:
  `run.state ∈ done | cancelled` **and** `leaseUntil` is `null` or expired,
  not bare `state` alone (PLAN.MD §10 "Corrected during M3" — a cancelled
  record with a still-live lease is mid-flight, not finished, and is never
  auto-resumed while in that state). `pollNow()` ticks every
  currently-watched annotation immediately — the e2e speed hook
  (`window.__thai.sync.pollNow`, `.claude/rules/testing.md`).
- `index.ts`'s `startSync()`: a one-time "enqueue every existing local
  record" migration (guarded by `meta.syncInitialized`, so Tyler's
  pre-sync library gets pushed once), then pull → push on load, pull (and
  retry a push) on `visibilitychange` → visible and on the `online` event,
  and push debounced **500ms** after any outbox write — but only after a
  clean push (every row succeeded): a failed, non-offline push instead
  schedules exactly one retry with exponential backoff (**30s → 60s → 120s
  → capped at 5 minutes**), never stacking a second concurrent backoff
  timer; an offline failure schedules nothing and waits for the `online`/
  `visibilitychange` listeners or the next outbox write. Idempotent (a
  second `startSync()` call returns the existing stop function); safe
  outside a browser (Vitest) since the `document`/`window` listeners are
  only attached when those globals exist.
