#!/usr/bin/env node
import { App } from 'aws-cdk-lib'
import { GithubOidcStack } from '../lib/github-oidc-stack.js'
import { PreviewStack } from '../lib/preview-stack.js'
import { SharedStack } from '../lib/shared-stack.js'
import { SiteStack } from '../lib/site-stack.js'

const env = { account: '063257577013', region: 'us-east-1' }
const app = new App()

new GithubOidcStack(app, 'ThaiLerDevGithubOidcStack', { env })
const shared = new SharedStack(app, 'ThaiLerDevSharedStack', { env })
const site = new SiteStack(app, 'ThaiLerDevSiteStack', { env })
site.addStackDependency(shared)

// A bare `cdk synth`/`cdk deploy` must see only the four stacks above — a
// preview stack only comes into being when `-c pr=<n>` is passed:
//   cdk deploy ThaiLerDevPreview<n>Stack -c pr=<n> -c preview=frontend|full-stack
const prContext = app.node.tryGetContext('pr')
if (prContext !== undefined) {
  const pr = Number.parseInt(String(prContext), 10)
  if (!Number.isInteger(pr) || pr <= 0) {
    throw new Error(`Context "pr" must be a positive integer, got ${JSON.stringify(prContext)}`)
  }

  const previewContext = app.node.tryGetContext('preview')
  if (previewContext !== 'frontend' && previewContext !== 'full-stack') {
    throw new Error(
      `Context "preview" must be "frontend" or "full-stack", got ${JSON.stringify(previewContext)}`,
    )
  }

  new PreviewStack(app, `ThaiLerDevPreview${pr}Stack`, {
    env,
    pr,
    mode: previewContext,
    modelProvider: app.node.tryGetContext('modelProvider'),
  })
}
