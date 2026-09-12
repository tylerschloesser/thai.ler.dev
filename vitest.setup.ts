// Polyfills `indexedDB`, `IDBKeyRange`, etc. onto globalThis for every test
// file, so Dexie (src/db/**) works under vitest's 'node' environment.
import 'fake-indexeddb/auto'
