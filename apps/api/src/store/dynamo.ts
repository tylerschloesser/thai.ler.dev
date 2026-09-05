import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'
import type { CollectionName, MutationRequest, StateResponse } from '@thai/schema'
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import { AWS_REGION, env } from '../env.ts'
import { idempotencySk, padTimestamp, pk, sk, syncWatermark, updatedSk } from '../keys.ts'
import type { Row } from '../normalize.ts'
import { refsToLoad, resolveMutations, toStateResponse } from './apply.ts'
import type { ApplyResult, RowRef, Store } from './index.ts'

const UPDATED_INDEX = 'by-updated'
const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60

type StoredRow = {
  pk: string
  sk: string
  sk2: string
  collection: CollectionName
  data: Row
}

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
 * Everything that changed for this user since `since`, tombstones included.
 * One `Query` against the `by-updated` LSI — the reason the client can poll
 * cheaply even when translation rows carry kilobytes of segments.
 */
async function readSince(
  doc: DynamoDBDocumentClient,
  userId: string,
  since: number,
): Promise<StateResponse> {
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

async function getRow(
  doc: DynamoDBDocumentClient,
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
async function putRow(
  doc: DynamoDBDocumentClient,
  userId: string,
  collection: CollectionName,
  row: Row,
): Promise<void> {
  await doc.send(
    new PutCommand({ TableName: env.tableName, Item: toStoredRow(userId, collection, row) }),
  )
}

async function batchGet(
  doc: DynamoDBDocumentClient,
  userId: string,
  refs: RowRef[],
): Promise<Map<string, Row>> {
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

/**
 * Applies a batch of mutations atomically under one idempotency key.
 *
 * The key is written as a conditioned item inside the same transaction, so a
 * retried outbox entry — the normal outcome of a request that timed out after
 * the server committed — fails the condition and is answered from the rows the
 * first attempt wrote, instead of duplicating them.
 */
async function applyMutations(
  doc: DynamoDBDocumentClient,
  userId: string,
  request: MutationRequest,
): Promise<ApplyResult> {
  const stamp = Date.now()
  const idempotencyKey = idempotencySk(request.idempotencyKey)

  const existing = await batchGet(doc, userId, refsToLoad(request))
  const resolved = resolveMutations(request, existing, stamp)

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
      return { rows: await replay(doc, userId, idempotencyKey), replayed: true }
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
  doc: DynamoDBDocumentClient,
  userId: string,
  idempotencyKey: string,
): Promise<Array<{ collection: CollectionName; row: Row }>> {
  const result = await doc.send(
    new GetCommand({ TableName: env.tableName, Key: { pk: pk(userId), sk: idempotencyKey } }),
  )
  const refs = (result.Item as IdempotencyRecord | undefined)?.refs ?? []
  const rows = await batchGet(doc, userId, refs)

  return refs.flatMap((ref) => {
    const row = rows.get(sk(ref.collection, ref.id))
    return row ? [{ collection: ref.collection, row }] : []
  })
}

export function createDynamoStore(): Store {
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }), {
    marshallOptions: { removeUndefinedValues: true },
  })

  return {
    readSince: (userId, since) => readSince(doc, userId, since),
    getRow: (userId, collection, id) => getRow(doc, userId, collection, id),
    putRow: (userId, collection, row) => putRow(doc, userId, collection, row),
    applyMutations: (userId, request) => applyMutations(doc, userId, request),
  }
}
