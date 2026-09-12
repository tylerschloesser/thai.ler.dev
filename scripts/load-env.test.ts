import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadEnv } from './load-env.ts'

// Never read from the repo root here - it has a real .env.local with
// CLI-pulled development vars. Everything runs against a throwaway temp
// dir instead.

let dir: string
const TOUCHED_KEYS = [
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
  'VERCEL_OIDC_TOKEN',
  'TURBO_TEAM',
  'NX_DAEMON',
  'BLOB_READ_WRITE_TOKEN',
  'SOME_APP_VAR',
  'ALREADY_SET',
]
let snapshot: Record<string, string | undefined>

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'thai-load-env-'))
  snapshot = {}
  for (const key of TOUCHED_KEYS) {
    snapshot[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  for (const key of TOUCHED_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key]
    else process.env[key] = snapshot[key]
  }
})

describe('loadEnv', () => {
  it('does nothing when neither file exists', () => {
    expect(() => loadEnv(dir)).not.toThrow()
    expect(process.env['SOME_APP_VAR']).toBeUndefined()
  })

  it('loads plain app vars from .env.local', async () => {
    await writeFile(path.join(dir, '.env.local'), 'SOME_APP_VAR=hello\n')
    loadEnv(dir)
    expect(process.env['SOME_APP_VAR']).toBe('hello')
  })

  it('never overrides a key already set in process.env', async () => {
    process.env['ALREADY_SET'] = 'shell-value'
    await writeFile(path.join(dir, '.env.local'), 'ALREADY_SET=file-value\n')
    loadEnv(dir)
    expect(process.env['ALREADY_SET']).toBe('shell-value')
  })

  it('.env.development.local takes precedence over .env.local for the same key', async () => {
    await writeFile(
      path.join(dir, '.env.development.local'),
      'SOME_APP_VAR=from-dev-local\n',
    )
    await writeFile(path.join(dir, '.env.local'), 'SOME_APP_VAR=from-local\n')
    loadEnv(dir)
    expect(process.env['SOME_APP_VAR']).toBe('from-dev-local')
  })

  it('ignores VERCEL and VERCEL_* system vars (except the two allowed ones)', async () => {
    await writeFile(
      path.join(dir, '.env.local'),
      [
        'VERCEL="1"',
        'VERCEL_ENV=development',
        'VERCEL_URL=some-deployment.vercel.app',
        'BLOB_READ_WRITE_TOKEN=vercel_blob_rw_test',
      ].join('\n'),
    )
    loadEnv(dir)
    expect(process.env['VERCEL']).toBeUndefined()
    expect(process.env['VERCEL_ENV']).toBeUndefined()
    expect(process.env['VERCEL_URL']).toBeUndefined()
    // Not a VERCEL_*-prefixed key, so it is loaded.
    expect(process.env['BLOB_READ_WRITE_TOKEN']).toBe('vercel_blob_rw_test')
  })

  it('still loads the two allow-listed VERCEL_* keys', async () => {
    await writeFile(
      path.join(dir, '.env.local'),
      [
        'VERCEL_AUTOMATION_BYPASS_SECRET=bypass-secret',
        'VERCEL_OIDC_TOKEN=oidc-token',
      ].join('\n'),
    )
    loadEnv(dir)
    expect(process.env['VERCEL_AUTOMATION_BYPASS_SECRET']).toBe('bypass-secret')
    expect(process.env['VERCEL_OIDC_TOKEN']).toBe('oidc-token')
  })

  it('ignores TURBO_* and NX_DAEMON', async () => {
    await writeFile(
      path.join(dir, '.env.local'),
      ['TURBO_TEAM=whatever', 'NX_DAEMON=false'].join('\n'),
    )
    loadEnv(dir)
    expect(process.env['TURBO_TEAM']).toBeUndefined()
    expect(process.env['NX_DAEMON']).toBeUndefined()
  })

  it('never logs values (no console output)', async () => {
    const logs: unknown[] = []
    const orig = console.log
    console.log = (...args: unknown[]) => logs.push(args)
    try {
      await writeFile(path.join(dir, '.env.local'), 'SOME_APP_VAR=secret\n')
      loadEnv(dir)
    } finally {
      console.log = orig
    }
    expect(logs).toEqual([])
  })
})
