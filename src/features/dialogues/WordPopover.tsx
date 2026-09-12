import type { NoteAnnotation, WordAnnotation } from '../../llm/schema'
import { SyllableRow } from './SyllableRow'
import styles from './WordPopover.module.css'

function formatEnumLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

function groupNotesByKind(
  notes: NoteAnnotation[],
): Array<{ kind: string; notes: NoteAnnotation[] }> {
  const order: string[] = []
  const byKind = new Map<string, NoteAnnotation[]>()
  for (const note of notes) {
    let group = byKind.get(note.kind)
    if (!group) {
      group = []
      byKind.set(note.kind, group)
      order.push(note.kind)
    }
    group.push(note)
  }
  return order.map((kind) => ({
    kind,
    notes: byKind.get(kind) as NoteAnnotation[],
  }))
}

export interface WordPopoverProps {
  word: WordAnnotation
  toneColors: boolean
}

/**
 * Popover content for one word chip: header (Thai/romanization/gloss/POS),
 * a `SyllableRow` per syllable, and notes grouped by kind (docs/plans/P0.md §4.3).
 * The Popover chrome itself (positioner/portal/arrow) lives in `WordChip`,
 * which renders this as its popup body.
 */
export function WordPopover({ word, toneColors }: WordPopoverProps) {
  const noteGroups = groupNotesByKind(word.notes)

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <p className={styles.thai} lang="th">
          {word.thai}
        </p>
        <p className={styles.romanization}>{word.romanization}</p>
        <p className={styles.gloss}>{word.gloss}</p>
        <span className={styles.pos}>{formatEnumLabel(word.partOfSpeech)}</span>
      </header>

      {word.syllables.length > 0 && (
        <ul className={styles.syllables} aria-label="Syllables">
          {word.syllables.map((syllable, index) => (
            <SyllableRow
              key={index}
              syllable={syllable}
              toneColors={toneColors}
            />
          ))}
        </ul>
      )}

      {noteGroups.length > 0 && (
        <div className={styles.notes}>
          {noteGroups.map((group) => (
            <div key={group.kind} className={styles.noteGroup}>
              <p className={styles.noteKind}>{formatEnumLabel(group.kind)}</p>
              <ul className={styles.noteList}>
                {group.notes.map((note, index) => (
                  <li key={index}>{note.text}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
