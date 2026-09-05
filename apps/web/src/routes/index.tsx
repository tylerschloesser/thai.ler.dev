import { createFileRoute } from '@tanstack/react-router'
import { Composer } from '../components/Composer/Composer.tsx'
import { TranslationList } from '../components/TranslationList/TranslationList.tsx'
import { hydrate } from '../db/sync.ts'
import styles from './index.module.css'

export const Route = createFileRoute('/')({
  // Warms the collections and restores the outbox, so the route never mounts
  // into an empty list — or one that is missing the user's own unsent writes.
  loader: () => hydrate(),
  component: Home,
})

function Home() {
  return (
    <div className={styles.page}>
      <section className={styles.intro}>
        <h1 className={styles.title}>Read Thai dialog</h1>
        <p className={styles.lede}>
          Paste a conversation. Every line comes back split into words, romanized and
          glossed, with the tones marked — then ask about anything that doesn&rsquo;t
          land.
        </p>
      </section>

      <Composer />
      <TranslationList />
    </div>
  )
}
