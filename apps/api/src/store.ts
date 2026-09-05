import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'
import {
  ClarificationSchema,
  TranslationSchema,
  type Clarification,
  type CollectionName,
  type Mutation,
  type MutationRequest,
  type StateResponse,
  type Translation,
} from '@thai/schema'
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import { AWS_REGION, env } from './env.ts'
import { idempotencySk, padTimestamp, pk, sk, syncWatermark, updatedSk } from './keys.ts'
import {
  InvalidMutationError,
  normalizeDelete,
  normalizeInsert,
  normalizeUpdate,
  type Row,
} from './normalize.ts'

const UPDATED_INDEX = 'by-updated'
const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }), {
  marshallOptions: { removeUndefinedValues: true },
})

type StoredRow = {
  pk: string
  sk: string
  sk2: string
  collection: CollectionName
  data: Row
}

type RowRef = { collection: CollectionName; id: string }

type IdempotencyRecord = {
  pk: string
  sk: string
  refs: RowRef[]
  expiresAt: number
}

function toStoredRow(userId: string, collection: CollectionName, row: Row): StoredRow {
  return {
    pk: pk(userId),
    sk: sk(collection, row.id),
    sk2: updatedSk(row.updatedAt, collection, row.id),
    collection,
    data: row,
  }
}

/**
 * Rows are validated on the way out rather than trusted. A row written by an
 * older deploy that no longer matches the schema is dropped with a log instead
 * of failing the whole sync — one bad row must not wedge a client forever.
 */
function toStateResponse(stored: StoredRow[], now: number): StateResponse {
  const translations: Translation[] = []
  const clarifications: Clarification[] = []

  for (const item of stored) {
    if (item.collection === 'translations') {
      const parsed = TranslationSchema.safeParse(item.data)
      if (parsed.success) translations.push(parsed.data)
      else console.error('dropping unparseable translation', item.sk, parsed.error.message)
    } else {
      const parsed = ClarificationSchema.safeParse(item.data)
      if (parsed.success) clarifications.push(parsed.data)
      else console.error('dropping unparseable clarification', item.sk, parsed.error.message)
    }
  }

  return { translations, clarifications, now }
}

/**
 * Everything that changed for this user since `since`, tombstones included.
 * One `Query` against the `by-updated` LSI — the reason the client can poll
 * cheaply even when translation rows carry kilobytes of segments.
 */
export async function readSince(userId: string, since: number): Promise<StateResponse> {
  const now = syncWatermark()
  const items: StoredRow[] = []
  let cursor: Record<string, unknown> | undefined

  do {
    const page = await doc.send(
      new QueryCommand({
        TableName: env.tableName,
        IndexName: UPDATED_INDEX,
        KeyConditionExpression: '#pk = :pk AND sk2 > :since',
        ExpressionAttributeNames: { '#pk': 'pk' },
        ExpressionAttributeValues: { ':pk': pk(userId), ':since': padTimestamp(since) },
        ExclusiveStartKey: cursor,
      }),
    )
    items.push(...((page.Items ?? []) as StoredRow[]))
    cursor = page.LastEvaluatedKey
  } while (cursor)

  return toStateResponse(items, now)
}

export async function getRow(
  userId: string,
  collection: CollectionName,
  id: string,
): Promise<Row | undefined> {
  const result = await doc.send(
    new GetCommand({
      TableName: env.tableName,
      Key: { pk: pk(userId), sk: sk(collection, id) },
    }),
  )
  return (result.Item as StoredRow | undefined)?.data
}

/** Used by the worker to write model output back. Unconditional: last write wins. */
export async function putRow(
  userId: string,
  collection: CollectionName,
  row: Row,
): Promise<void> {
  await doc.send(
    new PutCommand({ TableName: env.tableName, Item: toStoredRow(userId, collection, row) }),
  )
}

async function batchGet(userId: string, refs: RowRef[]): Promise<Map<string, Row>> {
  const found = new Map<string, Row>()
  if (refs.length === 0) return found

  // BatchGetItem caps at 100 keys; a mutation batch caps at 50, so one call.
  const result = await doc.send(
    new BatchGetCommand({
      RequestItems: {
        [env.tableName]: {
          Keys: refs.map((ref) => ({ pk: pk(userId), sk: sk(ref.collection, ref.id) })),
        },
      },
    }),
  )

  for (const item of (result.Responses?.[env.tableName] ?? []) as StoredRow[]) {
    found.set(item.sk, item.data)
  }
  return found
}

export type ApplyResult = {
  rows: Array<{ collection: CollectionName; row: Row }>
  replayed: boolean
}

/**
 * Applies a batch of mutations atomically under one idempotency key.
 *
 * The key is written as a conditioned item inside the same transaction, so a
 * retried outbox entry — the normal outcome of a request that timed out after
 * the server committed — fails the condition and is answered from the rows the
 * first attempt wrote, instead of duplicating them.
 */
export async function applyMutations(
  userId: string,
  request: MutationRequest,
): Promise<ApplyResult> {
  const stamp = Date.now()
  const idempotencyKey = idempotencySk(request.idempotencyKey)

  const existingRefs = request.mutations
    .filter((m): m is Extract<Mutation, { type: 'update' | 'delete' }> => m.type !== 'insert')
    .map((m) => ({ collection: m.collection, id: m.key }))
  const existing = await batchGet(userId, existingRefs)

  const resolved: Array<{ collection: CollectionName; row: Row }> = []
  for (const mutation of request.mutations) {
    const current = existing.get(sk(mutation.collection, mutation.key))

    if (mutation.type === 'insert') {
      // An insert that already landed (a replayed batch under a *new* key, say)
      // must not clobber server-produced content.
      if (current) continue
      resolved.push({
        collection: mutation.collection,
        row: normalizeInsert(mutation.collection, mutation.key, mutation.modified, stamp),
      })
      continue
    }

    if (!current) {
      // Updating or deleting something the server never saw. Nothing to do,
      // and nothing worth failing the whole batch over.
      continue
    }

    resolved.push({
      collection: mutation.collection,
      row:
        mutation.type === 'update'
          ? normalizeUpdate(mutation.collection, current, mutation.changes, stamp)
          : normalizeDelete(current, stamp),
    })
  }

  const record: IdempotencyRecord = {
    pk: pk(userId),
    sk: idempotencyKey,
    refs: resolved.map(({ collection, row }) => ({ collection, id: row.id })),
    expiresAt: Math.floor(stamp / 1000) + IDEMPOTENCY_TTL_SECONDS,
  }

  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: env.tableName,
              Item: record,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          ...resolved.map(({ collection, row }) => ({
            Put: { TableName: env.tableName, Item: toStoredRow(userId, collection, row) },
          })),
        ],
      }),
    )
  } catch (error) {
    if (error instanceof TransactionCanceledException && isIdempotencyConflict(error)) {
      return { rows: await replay(userId, idempotencyKey), replayed: true }
    }
    throw error
  }

  return { rows: resolved, replayed: false }
}

/** The idempotency item is index 0, so a conditional failure there means a replay. */
function isIdempotencyConflict(error: TransactionCanceledException): boolean {
  return error.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed'
}

async function replay(
  userId: string,
  idempotencyKey: string,
): Promise<Array<{ collection: CollectionName; row: Row }>> {
  const result = await doc.send(
    new GetCommand({ TableName: env.tableName, Key: { pk: pk(userId), sk: idempotencyKey } }),
  )
  const refs = (result.Item as IdempotencyRecord | undefined)?.refs ?? []
  const rows = await batchGet(userId, refs)

  return refs.flatMap((ref) => {
    const row = rows.get(sk(ref.collection, ref.id))
    return row ? [{ collection: ref.collection, row }] : []
  })
}

export { InvalidMutationError }
