import { ClarificationSchema, TranslationSchema } from '@thai/schema'
import {
  seedClarification,
  seedTranslationFailed,
  seedTranslationReady,
} from './fixtures/seed.ts'
import type { Store } from './store/index.ts'

/**
 * Seeds `store` with the demo fixtures for `userId`. Each row is parsed
 * through its schema first, so a fixture that has drifted from the schema
 * fails loudly here rather than silently serving an unparseable row later.
 */
export async function seed(store: Store, userId: string): Promise<void> {
  await store.putRow(userId, 'translations', TranslationSchema.parse(seedTranslationReady))
  await store.putRow(userId, 'translations', TranslationSchema.parse(seedTranslationFailed))
  await store.putRow(userId, 'clarifications', ClarificationSchema.parse(seedClarification))
}
