import { Toast } from '@base-ui/react/toast'
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { SyncIndicator } from '../components/SyncIndicator/SyncIndicator.tsx'
import { Toaster } from '../components/Toaster/Toaster.tsx'
import { usePendingPoll } from '../db/usePendingPoll.ts'
import { useWriteErrors } from '../db/useWriteErrors.ts'
import styles from './__root.module.css'

export type RouterContext = {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

function RootLayout() {
  return (
    <Toast.Provider>
      <Shell />
      <Toaster />
    </Toast.Provider>
  )
}

/** Inside the provider, so the hooks below can reach the toast manager. */
function Shell() {
  usePendingPoll()
  useWriteErrors()

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <span className={styles.brandThai} lang="th">
            แปล
          </span>
          <span className={styles.brandName}>Thai dialog</span>
        </Link>
        <SyncIndicator />
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
