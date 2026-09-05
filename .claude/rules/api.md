---
paths:
  - "apps/api/**"
  - "infra/cdk/lib/api.ts"
---

# apps/api

Loaded when you touch `apps/api/` or the CDK construct that deploys it (`infra/cdk/lib/api.ts`),
because the worker's timeouts are set on both sides.

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
- **Server-side work is derived, never requested.** The client sets `status: 'pending'`;
  `POST /api/mutations` inspects what landed in that state and invokes the worker. There is
  one write endpoint. Adding a `/api/translate` route would break the whole model.
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
- Requests arrive through CloudFront with an origin access control signature; the three
  gotchas that shape what the API sees (missing `lambda:InvokeFunction`, unsigned POST
  bodies, the `host`-only header exclusion) are in `.claude/rules/cdk.md`.
