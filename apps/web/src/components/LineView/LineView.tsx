import type { Line, Segment } from '@thai/schema'
import type { Selection } from '../TranslationDetail/TranslationDetail.tsx'
import styles from './LineView.module.css'

const TONE_MARKS: Record<string, string> = {
  mid: '—',
  low: '↘',
  falling: 'ˆ',
  high: '↗',
  rising: 'ˇ',
}

export function LineView({
  line,
  selection,
  onSelectionChange,
}: {
  line: Line
  selection: Selection | null
  onSelectionChange: (selection: Selection | null) => void
}) {
  const selected = new Set(selection?.segmentIds ?? [])

  function toggle(segmentId: string) {
    const next = new Set(selected)
    if (next.has(segmentId)) next.delete(segmentId)
    else next.add(segmentId)

    onSelectionChange(
      next.size === 0 ? null : { lineId: line.id, segmentIds: [...next] },
    )
  }

  return (
    <div className={styles.line}>
      {line.speaker ? <p className={styles.speaker}>{line.speaker}</p> : null}

      <div className={styles.segments}>
        {line.segments.map((segment) => (
          <SegmentButton
            key={segment.id}
            segment={segment}
            selected={selected.has(segment.id)}
            onToggle={() => toggle(segment.id)}
          />
        ))}
      </div>

      <p className={styles.translation}>{line.translation}</p>
    </div>
  )
}

function SegmentButton({
  segment,
  selected,
  onToggle,
}: {
  segment: Segment
  selected: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={styles.segment}
      aria-pressed={selected}
      onClick={onToggle}
      title={segment.note ?? undefined}
    >
      <span className={styles.thai} lang="th">
        {segment.thai}
      </span>
      <span className={styles.romanization}>
        {segment.syllables.map((syllable, index) => (
          // Syllables have no ids and are positional within a segment, so the
          // index is the stable identity here.
          <span key={index} className={styles.syllable}>
            {syllable.romanization}
            <span className={styles.tone} aria-hidden="true">
              {TONE_MARKS[syllable.tone] ?? ''}
            </span>
          </span>
        ))}
      </span>
      <span className={styles.gloss}>{segment.gloss}</span>
      {segment.note ? <span className={styles.noteDot} aria-hidden="true" /> : null}
    </button>
  )
}
