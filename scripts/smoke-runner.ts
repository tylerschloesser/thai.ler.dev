/**
 * Node smoke test for the M1 server core (PLAN.MD §5 M1 acceptance):
 * builds the app, starts `pnpm preview --port 4175` with the memory-free
 * `disk` Blob backend pointed at a fresh temp root, the `fake` provider,
 * and test mode on, then drives a real HTTP job end-to-end against it -
 * `POST /api/annotate` for an 8-line dialogue with a tight step budget
 * (forcing at least one continuation hop), polling `GET /api/annotation`
 * until it's done. Cleans up its namespace and stops the server whether it
 * passes or fails. Run with `pnpm exec tsx scripts/smoke-runner.ts`.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Repo root, resolved from this file's own location rather than
 * `process.cwd()` (PLAN.MD §5 M5) - the preview server is spawned as
 * `node_modules/.bin/vite` directly (see below), which needs an absolute
 * path regardless of where the script happens to be invoked from.
 */
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const PORT = 4175
const BASE_URL = `http://localhost:${PORT}`
const NAMESPACE = `smoke-${Math.random().toString(36).slice(2, 10)}`
const POLL_TIMEOUT_MS = 60_000
const HEALTH_TIMEOUT_MS = 30_000
const LINE_COUNT = 8

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else
        reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  for (;;) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`)
      if (res.ok) return
    } catch {
      // server not accepting connections yet
    }
    if (Date.now() > deadline) {
      throw new Error('preview server did not become healthy in time')
    }
    await sleep(300)
  }
}

/**
 * `pnpm preview` is really a chain (pnpm -> `sh -c` -> `vite`), and a plain
 * `child.kill()` only signals the immediate child, which can leave the
 * actual vite server orphaned and still holding the port (and this
 * process's inherited stdout, wedging the caller's pipe open). The child is
 * spawned `detached: true` so it heads its own process group; killing the
 * negated pid signals the whole group.
 */
function stopServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.pid === undefined) {
      resolve()
      return
    }
    const pid = child.pid
    child.once('exit', () => resolve())
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      // process group already gone
    }
    setTimeout(() => {
      if (child.exitCode === null) {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          // already gone
        }
      }
      resolve()
    }, 5_000)
  })
}

interface AnnotationRunLike {
  state: string
  steps: number
  hops: number
}
interface AnnotationRecordLike {
  id: string
  status: string
  run: AnnotationRunLike
}

async function main(): Promise<void> {
  console.log('Building...')
  await run('pnpm', ['build'])

  const diskRoot = await mkdtemp(path.join(tmpdir(), 'thai-smoke-'))
  console.log(
    `Starting preview on port ${PORT} (BLOB_DISK_ROOT=${diskRoot})...`,
  )

  // Spawn vite's own preview binary directly, not `pnpm preview` - a `pnpm`
  // script wrapper prints "Lifecycle | ELIFECYCLE  Command failed" whenever
  // its child exits non-zero, including from the SIGTERM `stopServer()`
  // sends below on a *successful* run. Vite itself exits 0 on SIGTERM (it
  // just doesn't print pnpm's lifecycle banner about it), so going straight
  // to the binary makes a clean run's output clean too, while a real
  // failure still surfaces via `waitForHealth()`/the HTTP assertions below
  // throwing and `exitCode` being set to 1.
  const server = spawn(
    path.join(REPO_ROOT, 'node_modules', '.bin', 'vite'),
    ['preview', '--port', String(PORT), '--strictPort'],
    {
      stdio: 'inherit',
      detached: true, // heads its own process group - see stopServer()
      env: {
        ...process.env,
        BLOB_BACKEND: 'disk',
        BLOB_DISK_ROOT: diskRoot,
        MODEL_PROVIDER: 'fake',
        ALLOW_TEST_MODE: '1',
      },
    },
  )

  let exitCode = 0
  try {
    await waitForHealth()

    const cookie = [
      `thai_ns=${NAMESPACE}`,
      'thai_model=fake-slow',
      'thai_fake_delay_ms=1000',
      'thai_step_budget_ms=1500',
    ].join('; ')

    const sourceText = Array.from(
      { length: LINE_COUNT },
      (_, i) => `Speaker${(i % 2) + 1}: line ${i}`,
    ).join('\n')

    console.log(`POSTing /api/annotate for a ${LINE_COUNT}-line dialogue...`)
    const annotateRes = await fetch(`${BASE_URL}/api/annotate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        dialogue: {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
          title: 'smoke-runner',
          sourceText,
          currentAnnotationId: null,
        },
        model: 'claude-opus-5',
      }),
    })
    if (annotateRes.status !== 202) {
      throw new Error(
        `POST /api/annotate returned ${annotateRes.status}: ${await annotateRes.text()}`,
      )
    }
    const created = (await annotateRes.json()) as {
      annotation: AnnotationRecordLike
    }
    console.log(`Annotation ${created.annotation.id} queued.`)

    const deadline = Date.now() + POLL_TIMEOUT_MS
    let final: AnnotationRecordLike = created.annotation
    for (;;) {
      const res = await fetch(
        `${BASE_URL}/api/annotation?id=${created.annotation.id}`,
        { headers: { cookie } },
      )
      final = (await res.json()) as AnnotationRecordLike
      if (final.run.state === 'done' || final.run.state === 'cancelled') break
      if (Date.now() > deadline) {
        throw new Error(
          `timed out after ${POLL_TIMEOUT_MS}ms waiting for the job to finish (last state: ${final.run.state})`,
        )
      }
      await sleep(500)
    }

    console.log(
      `Final: state=${final.run.state} status=${final.status} steps=${final.run.steps} hops=${final.run.hops}`,
    )

    if (final.status !== 'complete') {
      throw new Error(`expected status "complete", got "${final.status}"`)
    }
    if (final.run.steps < 2) {
      throw new Error(`expected run.steps >= 2, got ${final.run.steps}`)
    }
    if (final.run.hops < 1) {
      throw new Error(`expected run.hops >= 1, got ${final.run.hops}`)
    }

    console.log('Smoke test PASSED.')
  } catch (err) {
    exitCode = 1
    console.error(
      'Smoke test FAILED:',
      err instanceof Error ? err.message : String(err),
    )
  } finally {
    console.log('Deleting the smoke test namespace...')
    try {
      await fetch(`${BASE_URL}/api/test/namespace?ns=${NAMESPACE}`, {
        method: 'DELETE',
      })
    } catch {
      // best-effort cleanup
    }
    console.log('Stopping the preview server...')
    await stopServer(server)
    await rm(diskRoot, { recursive: true, force: true })
  }

  process.exit(exitCode)
}

main().catch((err: unknown) => {
  console.error(
    'smoke-runner failed:',
    err instanceof Error ? err.message : String(err),
  )
  process.exit(1)
})
