---
paths:
  - "packages/schema/**"
  - "apps/api/src/normalize.ts"
---

# packages/schema

Loaded when you touch `packages/schema/` or the API's `normalize.ts`.

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

Each collection's `id` in `apps/web/src/db/collections.ts` must match its entry in
`COLLECTION_NAMES` (`src/common.ts`). A mismatch makes the web outbox throw
`NonRetriableError` and silently drop every write.
