import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from './fixtures'
import type { AnnotationRecord, Dialogue, LineAnnotation } from '../src/db/db'
import { DB_SCHEMA_VERSION, LEGACY_RUN } from '../src/db/db'
import type { Snapshot } from '../src/db/snapshot'
import { SNAPSHOT_FORMAT } from '../src/db/snapshot'

const here = path.dirname(fileURLToPath(import.meta.url))
const sourceText = readFileSync(
  path.join(here, '..', 'src', 'fixtures', 'sample.dialogue.txt'),
  'utf8',
).trim()
const fixtureLines = JSON.parse(
  readFileSync(
    path.join(here, '..', 'src', 'fixtures', 'sample.annotation.json'),
    'utf8',
  ),
) as LineAnnotation[]

function makeSnapshot(): { dialogueId: string; snapshot: Snapshot } {
  const now = new Date().toISOString()
  const dialogueId = 'e2e-word-popover-dialogue'
  const dialogue: Dialogue = {
    id: dialogueId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    title: 'Ordering pad thai',
    sourceText,
    currentAnnotationId: 'e2e-word-popover-annotation',
  }
  const annotation: AnnotationRecord = {
    id: 'e2e-word-popover-annotation',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dialogueId,
    model: 'claude-opus-5',
    promptVersion: 1,
    schemaVersion: 1,
    lines: fixtureLines,
    lineErrors: fixtureLines.map(() => null),
    status: 'complete',
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    durationMs: 0,
    run: LEGACY_RUN,
  }
  return {
    dialogueId,
    snapshot: {
      format: SNAPSHOT_FORMAT,
      schemaVersion: DB_SCHEMA_VERSION,
      exportedAt: now,
      deviceId: 'e2e-word-popover-spec',
      dialogues: [dialogue],
      annotations: [annotation],
      settings: [],
    },
  }
}

test.describe('word popover', () => {
  test('clicking a word chip shows syllables, tone badges, and notes; Escape closes it', async ({
    page,
    seed,
  }) => {
    const { dialogueId, snapshot } = makeSnapshot()
    const firstWord = fixtureLines[0]?.sentences[0]?.words[0]
    if (!firstWord)
      throw new Error('Fixture has no first word to test against.')

    await page.goto('/')
    await seed(snapshot)
    await page.goto(`/d/${dialogueId}`)

    const chip = page
      .getByRole('button', { name: new RegExp(firstWord.thai) })
      .first()
    await expect(chip).toBeVisible()
    await chip.click()

    const syllableList = page.getByRole('list', { name: 'Syllables' })
    await expect(syllableList).toBeVisible()
    const syllableItems = syllableList.getByRole('listitem')
    await expect(syllableItems).toHaveCount(firstWord.syllables.length)

    // Tone badges: every syllable row shows its tone name as visible text
    // (scoped per-row since two syllables can share the same tone).
    for (const [index, syllable] of firstWord.syllables.entries()) {
      await expect(
        syllableItems.nth(index).getByText(syllable.tone, { exact: true }),
      ).toBeVisible()
    }

    // Notes grouped by kind.
    const firstNote = firstWord.notes[0]
    if (firstNote) {
      await expect(page.getByText(firstNote.text)).toBeVisible()
    }

    await page.keyboard.press('Escape')
    await expect(syllableList).not.toBeVisible()
  })
})
