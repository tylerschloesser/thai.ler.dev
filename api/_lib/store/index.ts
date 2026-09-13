import { createDiskStore, type DiskStoreOptions } from './disk.js'
import { createMemoryStore } from './memory.js'
import { createVercelStore } from './vercel.js'
import type { BlobBackend, BlobStore } from './paths.js'

export type { BlobBackend, BlobStore } from './paths.js'
export { StorePreconditionError } from './paths.js'
export { StoreSuspendedError } from './vercel.js'
export {
  isValidNamespace,
  manifestPath,
  prefixFor,
  recordPath,
  settingsPath,
  type RecordKind,
} from './paths.js'

export interface CreateStoreOptions {
  /** Only meaningful for `backend: 'disk'`; see `disk.ts`. */
  diskRoot?: DiskStoreOptions['root']
}

/** Selects a `BlobStore` implementation by `BLOB_BACKEND` (`api/_lib/env.ts`). */
export function createStore(
  backend: BlobBackend,
  opts: CreateStoreOptions = {},
): BlobStore {
  switch (backend) {
    case 'memory':
      return createMemoryStore()
    case 'disk':
      return createDiskStore({ root: opts.diskRoot })
    case 'vercel':
      return createVercelStore()
    default: {
      const exhaustive: never = backend
      throw new Error(`unknown blob backend: ${String(exhaustive)}`)
    }
  }
}
