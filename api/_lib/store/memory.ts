import type { BlobStore } from './paths.js'
import { StorePreconditionError } from './paths.js'

/**
 * In-memory `BlobStore` backend, used by the Playwright fast suite
 * (`BLOB_BACKEND=memory`) and Vitest. The Map lives on `globalThis` (keyed
 * by a well-known symbol) rather than in a module-level variable so it
 * survives module re-evaluation between requests - `vite preview`'s
 * `tsImport` (and `ssrLoadModule` under HMR) can re-evaluate `memory.ts` on
 * every request, which would otherwise reset the store on every call.
 */

interface Entry {
  value: unknown
  etag: string
}

const GLOBAL_KEY = Symbol.for('thai.ler.dev/api/_lib/store/memory')

interface GlobalWithStore {
  [GLOBAL_KEY]?: Map<string, Entry>
}

function getMap(): Map<string, Entry> {
  const g = globalThis as GlobalWithStore
  let map = g[GLOBAL_KEY]
  if (!map) {
    map = new Map()
    g[GLOBAL_KEY] = map
  }
  return map
}

let counter = 0
function nextEtag(): string {
  counter += 1
  return `mem-${Date.now().toString(36)}-${counter}`
}

export function createMemoryStore(): BlobStore {
  const map = getMap()

  return {
    async getJson<T>(path: string) {
      const entry = map.get(path)
      if (!entry) return null
      return { value: entry.value as T, etag: entry.etag }
    },

    async putJson(path, value, opts) {
      const current = map.get(path)
      if (opts?.ifMatch !== undefined) {
        if (!current || current.etag !== opts.ifMatch) {
          throw new StorePreconditionError(path)
        }
      }
      const etag = nextEtag()
      map.set(path, { value, etag })
      return { etag }
    },

    async list(prefix) {
      const out: Array<{ pathname: string; url: string }> = []
      for (const pathname of map.keys()) {
        if (pathname.startsWith(prefix)) {
          out.push({ pathname, url: `memory://${pathname}` })
        }
      }
      return out
    },

    async del(urls) {
      for (const url of urls) {
        const pathname = url.startsWith('memory://')
          ? url.slice('memory://'.length)
          : url
        map.delete(pathname)
      }
    },
  }
}

/** Test-only escape hatch: clears every entry from the shared global map. */
export function resetMemoryStoreForTests(): void {
  getMap().clear()
}
