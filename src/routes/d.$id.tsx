import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/d/$id')({
  component: DialogueView,
})

function DialogueView() {
  const { id } = Route.useParams()
  return (
    <div>
      <h1>Dialogue {id}</h1>
      <p>The annotated dialogue will render here.</p>
    </div>
  )
}
