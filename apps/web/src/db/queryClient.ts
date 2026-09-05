import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { QueryClient } from '@tanstack/react-query'
import { clear, del, get, set } from 'idb-keyval'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // `offlineFirst` runs the queryFn once even with no connection, so a
      // rehydrated cache is served immediately instead of the query sitting
      // paused until the network returns.
      networkMode: 'offlineFirst',
      // Durable retries are the outbox's job, not the query cache's.
      retry: 1,
      staleTime: 30_000,
      gcTime: Number.POSITIVE_INFINITY,
    },
  },
})

const IDB_KEY = 'thai.query-cache'

/**
 * What makes a cold start with no network show real data: the query cache is
 * written to IndexedDB and restored before the first render. Query collections
 * are backed by a QueryObserver, so a restored cache seeds the collections
 * themselves — no separate persistence layer for TanStack DB.
 */
export const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key) => (await get<string>(key)) ?? null,
    setItem: async (key, value) => set(key, value),
    removeItem: async (key) => del(key),
  },
  key: IDB_KEY,
  throttleTime: 1_000,
})

/**
 * Cached rows outliving a session on a shared device is the failure mode this
 * prevents. Sign-out must call this, not just clear the in-memory client.
 */
export async function clearPersistedState(): Promise<void> {
  queryClient.clear()
  await clear()
}
