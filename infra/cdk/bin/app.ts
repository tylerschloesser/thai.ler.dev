#!/usr/bin/env node
import { App } from 'aws-cdk-lib'
import { GithubOidcStack } from '../lib/github-oidc-stack.js'
import { SiteStack } from '../lib/site-stack.js'

const env = { account: '063257577013', region: 'us-east-1' }
const app = new App()

new GithubOidcStack(app, 'ThaiLerDevGithubOidcStack', { env })
new SiteStack(app, 'ThaiLerDevSiteStack', { env })
