---
paths:
  - 'src/db/**'
  - 'src/lib/**'
---

# Data layer rules

Data layer lives at `src/db/` (`db.ts`, `repo.ts`, `snapshot.ts`,
`settings.ts`, `meta.ts`) plus pure helpers in `src/lib/`.

## Repo-only writes

`src/db/repo.ts` is the **only** write path to Dexie tables. Components and
hooks call repo functions (`createDialogue`, `renameDialogue`,
`softDeleteDialogue`, `listDialogues` (live), `getDialogue`,
`getAnnotation`, `getAnnotationsByIds` (batched, for list rendering),
`createAnnotation`, `upsertAnnotationLine`, `finalizeAnnotation`,
`setCurrentAnnotation`) — never `db.table.put/add/delete` directly outside
`repo.ts`. Every write bumps `updatedAt`. Settings (`src/db/settings.ts`)
are the one exception: single-key rows with defaults, not soft-deletable
records, so they own their own `getSetting`/`setSetting`/`useSetting` API
instead of living in `repo.ts`.

## Schema (Dexie, `src/db/db.ts`)

```ts
interface Base {
  id: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
interface Dialogue extends Base {
  title: string
  sourceText: string
  currentAnnotationId: string | null
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
}
```

Tables: `dialogues: id, updatedAt, deletedAt`, `annotations: id, dialogueId,
updatedAt`, `settings: key`, `meta: key`. Annotations are a separate table
from dialogues so that reading a `Dialogue` for the title/sourceText/list
view never touches the `lines` blob. The library's per-row status chip is
the one place that still needs an `AnnotationRecord` (for `status`/
`lineErrors`) — IndexedDB always deserializes a full record, so that read
can't avoid the blob, but `DialogueList.tsx` pays that cost once via a
single batched `getAnnotationsByIds`, not once per row.

## Migration rule

Any schema change bumps the Dexie version number and adds a `.upgrade()`
callback — never mutate an existing versioned schema in place. Bump
`meta.schemaVersion` alongside it.

## Sync-readiness invariants

Every record: `id` is a UUID (`src/lib/ids.ts`'s `newId`, currently
`crypto.randomUUID()`); timestamps are ISO-8601 strings; deletes are soft
(`deletedAt`), queries filter `deletedAt === null`; every write sets
`updatedAt`. `deviceId` is **not** stamped on individual records — it's a
single value in the `meta` table (`getDeviceId()`, `src/db/meta.ts`),
included once per `Snapshot` (see below) for future multi-device sync, not
per-row. Hard-purge tombstones older than 90 days on startup
(`purgeTombstones` in `db.ts`, called fire-and-forget from
`src/app/debug.ts`).

## Snapshot format (`src/db/snapshot.ts`)

The export format is the future sync payload — don't diverge from it:

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

`mergeSnapshot(local, incoming)` is last-writer-wins per record by
`updatedAt`, with tombstones winning ties. Import always merges — it never
wipes local data. An unknown `schemaVersion` on import must be refused with
a readable error, not silently coerced. Unit-test LWW, tombstone
resurrection prevention, and the unknown-schemaVersion refusal.
