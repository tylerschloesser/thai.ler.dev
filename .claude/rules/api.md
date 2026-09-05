---
paths:
  - "apps/api/**"
  - "infra/cdk/lib/api.ts"
---

# apps/api

Loaded when you touch `apps/api/` or the CDK construct that deploys it (`infra/cdk/lib/api.ts`),
because the worker's timeouts are set on both sides.

- ESM + `nodenext` like `infra/cdk`, but relative imports carry a `.ts` extension rather than
  the `.js` extension plain `nodenext` expects. `lambda.ts` and `worker.ts` are the entries CDK
  bundles with esbuild, which resolves that fine. `local.ts` and `seed-table.ts` are never
  bundled — `tsx` runs them directly for `dev`/`start`/`seed` — but keep the same convention,
  because `tsx` resolves a `.ts` specifier natively too. `infra/cdk` runs under `tsx` as well,
  but kept the `.js` convention `nodenext` expects.
- `getStore()` (`src/store/index.ts`) and `getModel()` (`src/model/index.ts`) each lazily build
  and cache one implementation per process, choosing it on first call from an env var — lazy so
  a test, or `applyLocalDefaults()`, can still set that var before anything reads it.
- `getUserId(c)` in `src/auth.ts` is the only place the API learns who is calling — the whole
  auth seam. Every read and write is partitioned by what it returns.
- The `Dispatcher` (`src/dispatch.ts`) is the one seam **injected**, not env-selected: each
  composition root (`lambda.ts`, `local.ts`) builds one and passes it to
  `createApp({ dispatcher })`. That's because `app.ts` must never take a value import of
  `worker.ts` — it would drag the Anthropic SDK into the request Lambda's bundle just to reach
  one type. The `WorkerEvent` type import is fine; type-only imports are erased.
- Env switches, all read through `src/env.ts` (the only file that touches `process.env` — a
  stray read anywhere else is a bug):

  | var | values | default | Lambda sets it? |
  | --- | --- | --- | --- |
  | `STORE` | dynamo, memory | dynamo | no |
  | `MODEL_PROVIDER` | anthropic, fake | anthropic | no |
  | `AUTH` | constant, header | constant | no |
  | `FAKE_MODEL_DELAY_MS` | milliseconds | 1500 | no |
  | `PORT` | port number | 8787 | no — local dev server only |
  | `SEED_USER_ID` | a user id | caller's own default | no — read by `seed-table.ts` only |

  Lambda sets none of the first three, so deployed code always takes the Dynamo + Anthropic +
  constant path. `header` auth (reads `x-id-token`, unverified) exists only so local dev and e2e
  get a cheap per-run data partition — it is **local-only** and must never become a way to spoof
  a user in production.
- `local.ts` is the local composition root (`dev` runs it under `tsx watch`, `start` runs it
  once): it calls `applyLocalDefaults()` before anything else reads env, wires an in-process
  `Dispatcher` straight to the worker's handler, and seeds a fresh `MemoryStore` from
  `src/fixtures/seed.ts` via `src/seed.ts`. `pnpm --filter api seed` runs `seed-table.ts`
  instead, which imports `createDynamoStore` directly — bypassing `getStore()`, so a stray
  `STORE=memory` can't quietly seed the wrong backend — to seed a real table.
- **Key shapes** (`src/keys.ts`): `pk = USER#<id>`, `sk = <collection>#<id>`, idempotency
  records at `IDEMP#<key>`, and the `by-updated` LSI sorts on
  `sk2 = <16-digit zero-padded updatedAt>#<collection>#<id>`. Zero-padded so lexicographic
  order matches numeric; suffixed so same-millisecond rows stay distinct *and* so the `>`
  query still returns rows whose `updatedAt` equals `since`. The LSI is deliberately sparse —
  idempotency records carry no `sk2` and stay out of it.
- **Idempotency depends on ordering**, in `DynamoStore` (`src/store/dynamo.ts`). `POST
  /api/mutations` writes the `IDEMP#` item under `attribute_not_exists` as **index 0** of the
  `TransactItems` array, and detects a replay by reading `CancellationReasons[0]`. Reorder that
  array and a retried outbox entry duplicates its rows instead of being answered from the first
  attempt's. `MemoryStore` (`src/store/memory.ts`) fakes the same guarantee with a synchronous
  check-then-set on a `Map` (no `await` in between, so nothing else can interleave) — but both
  stores share the actual resolve-and-validate logic in `src/store/apply.ts`, so a bug fixed in
  one is fixed in both.
- Return a 4xx for anything permanently invalid. The client turns 4xx into a
  `NonRetriableError` and drops the entry; anything else is retried forever, and a bad
  mutation at the head of a FIFO outbox blocks every write behind it.
- **Server-side work is derived, never requested.** The client sets `status: 'pending'`;
  `POST /api/mutations` inspects what landed in that state and invokes the worker. There is
  one write endpoint. Adding a `/api/translate` route would break the whole model.
- `AnthropicModel` (`src/model/anthropic.ts`) calls `claude-opus-5` with adaptive thinking and
  structured output (`messages.parse` + `zodOutputFormat`, reading `response.parsed_output`).
  Its Lambda timeout is 10 minutes and the SDK client's is 9 — **those two numbers must move
  together**, because the gap is what lets a timed-out call still record `status: 'failed'`
  instead of leaving the row stuck `pending`.
- The fake model (`src/model/fake.ts`, `MODEL_PROVIDER=fake`) is deterministic from its input —
  no network call, no secret — so a test can assert on its output: `[fake] <line>` translations,
  a `Fake breakdown of N line(s).` summary, `[fake] You asked "<q>" about <selection>` answers.
  A row whose text contains `FAIL` fails its first attempt, but only **once per row id per
  process** — the failed-once set is an in-memory `Set`, so a retry after a restart (a fresh
  Lambda instance in a `MODEL_PROVIDER=fake` preview, or a restarted `dev`) fails again too.
- The worker re-reads its row and exits unless it is still `pending`, so duplicate
  invocations (Lambda async retries, a user pressing Retry) are harmless. It is dispatched
  only when the mutation batch was not a replay, and a dispatch failure is logged rather than
  returned — the write is already committed, and Retry covers the rest.
- `/api/state` returns everything changed since `since`, tombstones included, from one Query
  against the `by-updated` LSI (`DynamoStore`), or the equivalent scan (`MemoryStore`).
  The watermark is rewound a couple of seconds (`SYNC_WATERMARK_SKEW_MS`) so a row committed
  concurrently with a read is not skipped. Rows are re-validated on the way out
  (`src/store/apply.ts`) and a bad one is dropped with a log rather than failing the sync, so a
  single unparseable row can't wedge a client forever.
- Requests arrive through CloudFront with an origin access control signature; the three
  gotchas that shape what the API sees (missing `lambda:InvokeFunction`, unsigned POST
  bodies, the `host`-only header exclusion) are in `.claude/rules/cdk.md`.
