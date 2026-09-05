import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { AWS_REGION, env } from './env.ts'
import type { WorkerEvent } from './worker.ts'

/**
 * How `POST /api/mutations` hands a pending row off to the worker. Injected
 * rather than selected from env like the store and model seams, because
 * `app.ts` must not import `worker.ts` at runtime — a value import would pull
 * the Anthropic SDK into the request Lambda's bundle. A type-only import of
 * `WorkerEvent` is erased and safe.
 */
export interface Dispatcher {
  dispatch(event: WorkerEvent): Promise<void>
}

/**
 * Fires the worker as an async Lambda invoke. The `LambdaClient` is
 * constructed here, not at module scope, so importing this module without
 * calling the factory never touches AWS.
 */
export function createLambdaDispatcher(): Dispatcher {
  const lambda = new LambdaClient({ region: AWS_REGION })

  return {
    async dispatch(event: WorkerEvent): Promise<void> {
      await lambda.send(
        new InvokeCommand({
          FunctionName: env.workerFunctionName,
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify(event)),
        }),
      )
    },
  }
}

/**
 * The local equivalent of an async Lambda invoke: scheduling `run` for the
 * next tick and resolving immediately means the POST returns before the
 * model work starts, same as the real dispatcher.
 */
export function createInProcessDispatcher(
  run: (event: WorkerEvent) => Promise<void>,
): Dispatcher {
  return {
    async dispatch(event: WorkerEvent): Promise<void> {
      setTimeout(() => {
        run(event).catch((error: unknown) => {
          console.error('failed to run worker in-process', event.collection, event.id, error)
        })
      }, 0)
    },
  }
}
