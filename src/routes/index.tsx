import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  return (
    <div>
      <h1>thai.ler.dev</h1>
      <p>Paste a dialogue to get an annotated breakdown. Coming soon.</p>
    </div>
  )
}
