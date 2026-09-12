import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { BlobStore } from './paths.js'
import { StorePreconditionError } from './paths.js'

/**
 * Local-disk `BlobStore` backend (`pnpm dev` default: `BLOB_BACKEND=disk`),
 * so annotation jobs survive a dev-server restart. Root defaults to
 * `.data/blob/` (gitignored); tests override `root` to a temp directory so
 * they never touch the real one.
 *
 * The etag is a content hash rather than mtime/size, so writing the same
 * bytes twice in the same millisecond (as a fast test can) still yields a
 * stable, comparable etag, and an overwrite with different content always
 * changes it.
 */

export interface DiskStoreOptions {
  root?: string
}

function etagFor(raw: string): string {
  return createHash('sha1').update(raw).digest('hex')
}

export function createDiskStore(opts: DiskStoreOptions = {}): BlobStore {
  const root = opts.root ?? '.data/blob'

  function resolve(pathname: string): string {
    return path.join(root, pathname)
  }

  async function readRaw(pathname: string): Promise<string | null> {
    try {
      return await readFile(resolve(pathname), 'utf8')
    } catch (err) {
      if (isEnoent(err)) return null
      throw err
    }
  }

  return {
    async getJson<T>(pathname: string) {
      const raw = await readRaw(pathname)
      if (raw === null) return null
      return { value: JSON.parse(raw) as T, etag: etagFor(raw) }
    },

    async putJson(pathname, value, opts) {
      const full = resolve(pathname)
      if (opts?.ifMatch !== undefined) {
        const current = await readRaw(pathname)
        if (current === null || etagFor(current) !== opts.ifMatch) {
          throw new StorePreconditionError(pathname)
        }
      }
      const raw = JSON.stringify(value)
      await mkdir(path.dirname(full), { recursive: true })
      await writeFile(full, raw, 'utf8')
      return { etag: etagFor(raw) }
    },

    async list(prefix) {
      const out: Array<{ pathname: string; url: string }> = []
      await walk(root, '')
      return out

      async function walk(dir: string, relDir: string): Promise<void> {
        let entries
        try {
          entries = await readdir(dir, { withFileTypes: true })
        } catch (err) {
          if (isEnoent(err)) return
          throw err
        }
        for (const entry of entries) {
          const rel = relDir ? `${relDir}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            await walk(path.join(dir, entry.name), rel)
          } else if (rel.startsWith(prefix)) {
            out.push({ pathname: rel, url: rel })
          }
        }
      }
    },

    async del(urls) {
      for (const url of urls) {
        try {
          await rm(resolve(url), { force: true })
        } catch (err) {
          if (!isEnoent(err)) throw err
        }
      }
    },
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ENOENT'
  )
}
