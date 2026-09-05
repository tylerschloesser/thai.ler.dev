import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { DEV_USER_ID } from './auth.ts'
import { createInProcessDispatcher } from './dispatch.ts'
import { applyLocalDefaults, env } from './env.ts'
import { seed } from './seed.ts'
import { getStore } from './store/index.ts'
import { handler } from './worker.ts'

/**
 * The local composition root: no AWS, no CDK, no deployed API. `pnpm
 * --filter api start` runs this directly against an in-memory store and a
 * fake model, dispatching worker runs in-process instead of through Lambda.
 */

// Before anything below reads env, so STORE/MODEL_PROVIDER/AUTH have local
// defaults unless the caller set them explicitly.
applyLocalDefaults()

const store = getStore()
await seed(store, DEV_USER_ID)

const app = createApp({ dispatcher: createInProcessDispatcher(handler) })

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`)
  console.log(`store=${env.store} modelProvider=${env.modelProvider} auth=${env.auth}`)
})
