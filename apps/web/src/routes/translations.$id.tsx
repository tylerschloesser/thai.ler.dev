import { createFileRoute } from '@tanstack/react-router'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { RouteNotFound } from '../components/Boundary/Boundary.tsx'
import { TranslationDetail } from '../components/TranslationDetail/TranslationDetail.tsx'
import { translations } from '../db/collections.ts'
import { hydrate } from '../db/sync.ts'

export const Route = createFileRoute('/translations/$id')({
  loader: () => hydrate(),
  component: TranslationRoute,
})

function TranslationRoute() {
  const { id } = Route.useParams()

  const { data } = useLiveQuery({
    query: (q) => q.from({ row: translations }).where(({ row }) => eq(row.id, id)).findOne(),
  })

  // Checked live rather than in the loader. The row can also vanish while the
  // page is open — deleted here, or deleted on another device and synced in —
  // and both cases deserve the same answer, so there is one code path for them.
  if (!data) return <RouteNotFound />

  return <TranslationDetail translation={data} />
}
