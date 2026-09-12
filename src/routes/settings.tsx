import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

function Settings() {
  return (
    <div>
      <h1>Settings</h1>
      <p>Model, API key, display defaults, and theme will live here.</p>
    </div>
  )
}
