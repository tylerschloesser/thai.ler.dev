import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequestListener } from '@remix-run/node-fetch-server'
import { tsImport } from 'tsx/esm/api'
import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import { loadEnv } from './load-env.ts'

/**
 * Serves `api/*.ts` (web-standard Vercel Function handlers) from both
 * `vite dev` (`configureServer`, via `server.ssrLoadModule` so handlers get
 * HMR) and `vite preview`/Playwright's `webServer` (`configurePreviewServer`,
 * via `tsx/esm/api`'s `tsImport` - Node can't resolve the extensionless
 * relative imports inside `src/llm`/`src/lib` on its own). PLAN.MD §4.7,
 * §10.
 */

const API_ROOT = path.resolve(process.cwd(), 'api')

type ApiModule = Record<string, unknown>
type Loader = (file: string) => Promise<ApiModule>

const NO_STORE_JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'private, no-store',
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, NO_STORE_JSON_HEADERS)
  res.end(JSON.stringify(body))
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * `/health` -> `api/health.ts`, `/annotation/resume` -> `api/annotation/resume.ts`.
 * Strips the query string, rejects any segment starting with `_` (not
 * routed - `api/_lib/**`) or containing `..`, and requires the resolved
 * file to actually exist. Returns null for anything that should be a 404,
 * never a path outside `api/`.
 */
export function resolveApiFile(url: string): string | null {
  const withoutQuery = (url.split('?')[0] ?? '').replace(/^\/+/, '')
  if (withoutQuery === '') return null

  const segments = withoutQuery.split('/')
  for (const segment of segments) {
    if (segment === '' || segment.startsWith('_') || segment.includes('..')) {
      return null
    }
  }

  const full = path.join(API_ROOT, `${path.join(...segments)}.ts`)
  if (full !== API_ROOT && !full.startsWith(API_ROOT + path.sep)) return null
  if (!existsSync(full)) return null
  return full
}

/**
 * Env defaults for local development (PLAN.MD §4.7, §4.9), applied on top
 * of whatever `scripts/load-env.ts` loaded from `.env.development.local` /
 * `.env.local` - never overriding a value the shell (or those files)
 * already set.
 */
function applyDevEnvDefaults(): void {
  loadEnv()

  const defaults: Record<string, string> = {
    BLOB_BACKEND: 'disk',
    ALLOW_TEST_MODE: '1',
    STEP_BUDGET_MS: '250000',
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  if (process.env['MODEL_PROVIDER'] === undefined) {
    if (process.env['ANTHROPIC_API_KEY']) {
      process.env['MODEL_PROVIDER'] = 'anthropic'
    } else {
      process.env['MODEL_PROVIDER'] = 'fake'
      // eslint-disable-next-line no-console
      console.warn(
        '[thai-api] No ANTHROPIC_API_KEY set - using the fake provider for local dev.',
      )
    }
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  load: Loader,
  moduleCache?: Map<string, Promise<ApiModule>>,
): Promise<void> {
  const file = resolveApiFile(req.url ?? '')
  if (!file) {
    sendJson(res, 404, {
      error: {
        kind: 'not_found',
        message: `no API route for ${req.url ?? ''}`,
      },
    })
    return
  }

  let modPromise = moduleCache?.get(file)
  if (!modPromise) {
    modPromise = load(file)
    moduleCache?.set(file, modPromise)
  }

  let mod: ApiModule
  try {
    mod = await modPromise
  } catch (err) {
    moduleCache?.delete(file)
    sendJson(res, 500, {
      error: { kind: 'internal', message: errorMessage(err) },
    })
    return
  }

  const method = (req.method ?? 'GET').toUpperCase()
  const handler = mod[method]
  if (typeof handler !== 'function') {
    sendJson(res, 405, {
      error: {
        kind: 'bad_request',
        message: `no ${method} handler for ${req.url ?? ''}`,
      },
    })
    return
  }

  const listener = createRequestListener(async (request) => {
    try {
      return (await (handler as (r: Request) => Promise<Response> | Response)(
        request,
      )) as Response
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: { kind: 'internal', message: errorMessage(err) },
        }),
        { status: 500, headers: NO_STORE_JSON_HEADERS },
      )
    }
  })
  listener(req, res)
}

function mount(
  server: ViteDevServer | PreviewServer,
  load: Loader,
  moduleCache?: Map<string, Promise<ApiModule>>,
): void {
  server.middlewares.use('/api', (req, res) => {
    void handleRequest(req, res, load, moduleCache)
  })
}

export function apiPlugin(): Plugin {
  // tsImport re-evaluates the module on every call, which would reset the
  // memory BlobStore backend's module-level state on every request - cache
  // by resolved file path for the lifetime of the preview process. Not
  // needed in dev: server.ssrLoadModule already caches via Vite's module
  // graph (and invalidates on file change, giving handlers HMR).
  const previewModuleCache = new Map<string, Promise<ApiModule>>()

  return {
    name: 'thai-api',
    configureServer(server) {
      applyDevEnvDefaults()
      mount(server, (file) => server.ssrLoadModule(file))
    },
    configurePreviewServer(server) {
      applyDevEnvDefaults()
      mount(
        server,
        (file) => tsImport(pathToFileURL(file).href, import.meta.url),
        previewModuleCache,
      )
    },
  }
}
