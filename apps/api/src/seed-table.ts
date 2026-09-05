import { DEV_USER_ID } from './auth.ts'
import { env } from './env.ts'
import { seed } from './seed.ts'
import { createDynamoStore } from './store/dynamo.ts'

/**
 * CLI for seeding a real DynamoDB table (used by preview stacks). Imports
 * `createDynamoStore` directly rather than going through `getStore()`, so a
 * stray `STORE=memory` can't quietly point this at the memory store instead
 * of the table it was told to seed.
 */
async function main(): Promise<void> {
  // `env.tableName` throws a clear "missing required env var TABLE_NAME" if
  // unset — read it eagerly so that failure happens before any DynamoDB call.
  const tableName = env.tableName
  const userId = env.seedUserId ?? DEV_USER_ID

  await seed(createDynamoStore(), userId)

  console.log(`seeded fixtures into ${tableName} for user ${userId}`)
}

main().catch((error: unknown) => {
  console.error('seed-table failed', error)
  process.exitCode = 1
})
