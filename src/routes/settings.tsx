import { createFileRoute } from '@tanstack/react-router'
import { SettingsForm } from '../features/settings/SettingsForm'
import { SyncStatus } from '../features/settings/SyncStatus'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

function Settings() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)',
        maxWidth: '72ch',
        margin: '0 auto',
      }}
    >
      <h1>Settings</h1>
      <SettingsForm />
      <SyncStatus />
    </div>
  )
}
