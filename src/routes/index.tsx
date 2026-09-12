import { createFileRoute } from '@tanstack/react-router'
import { Composer } from '../features/dialogues/Composer'
import { DialogueList } from '../features/dialogues/DialogueList'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
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
      <h1>thai.ler.dev</h1>
      <Composer />
      <DialogueList />
    </div>
  )
}
