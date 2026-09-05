import { handle } from 'hono/aws-lambda'
import { createApp } from './app.ts'
import { createLambdaDispatcher } from './dispatch.ts'

export const handler = handle(createApp({ dispatcher: createLambdaDispatcher() }))
