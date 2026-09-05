import { createRouter } from '@tanstack/react-router'
import {
  RouteError,
  RouteNotFound,
  RoutePending,
} from './components/Boundary/Boundary.tsx'
import { queryClient } from './db/queryClient.ts'
import { routeTree } from './routeTree.gen.ts'

export const router = createRouter({
  routeTree,
  // Loaders reach the cache through context rather than importing it, which is
  // what keeps them testable and is the idiomatic Router/Query integration.
  context: { queryClient },
  defaultPreload: 'intent',
  // 0 hands the freshness decision to TanStack Query, so the router never
  // re-runs a loader for data the cache already considers fresh.
  defaultPreloadStaleTime: 0,
  defaultPendingComponent: RoutePending,
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
  // Fast navigations resolve without ever showing a spinner; slow ones show it
  // for long enough not to flash.
  defaultPendingMs: 300,
  defaultPendingMinMs: 400,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
