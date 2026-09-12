import { createFileRoute } from '@tanstack/react-router'
import { DialogueView } from '../features/dialogues/DialogueView'

export const Route = createFileRoute('/d/$id')({
  component: DialogueViewRoute,
})

function DialogueViewRoute() {
  const { id } = Route.useParams()
  return <DialogueView dialogueId={id} />
}
