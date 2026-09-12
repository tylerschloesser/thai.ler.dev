import {
  createRootRouteWithContext,
  Link,
  Outlet,
} from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { useTheme } from '../app/theme'
import type { Theme } from '../app/theme'
import { Toggle } from '../ui/Toggle'
import { ToggleGroup } from '../ui/ToggleGroup'

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
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          flexWrap: 'wrap',
          padding: 'var(--space-4)',
        }}
      >
        <Link to="/">thai.ler.dev</Link>
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
          }}
        >
          <Link to="/">Library</Link>
          <Link to="/settings">Settings</Link>
          <ThemeToggle />
        </nav>
      </header>
      <main style={{ padding: 'var(--space-4)' }}>
        <Outlet />
      </main>
    </>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <ToggleGroup
      aria-label="Theme"
      value={[theme]}
      onValueChange={(value) => {
        const next = value[0] as Theme | undefined
        if (next) setTheme(next)
      }}
    >
      <Toggle value="system">System</Toggle>
      <Toggle value="light">Light</Toggle>
      <Toggle value="dark">Dark</Toggle>
    </ToggleGroup>
  )
}

function NotFound() {
  return <p>Not found</p>
}
