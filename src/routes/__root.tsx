import {
  createRootRouteWithContext,
  Link,
  Outlet,
} from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Shell,
  notFoundComponent: NotFound,
})

function Shell() {
  return (
    <>
      <header>
        <Link to="/">thai.ler.dev</Link>
        <nav>
          <Link to="/">Library</Link>
          <Link to="/settings">Settings</Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}

function NotFound() {
  return <p>Not found</p>
}
