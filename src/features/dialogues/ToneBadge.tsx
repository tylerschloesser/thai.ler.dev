import type { Tone } from '../../llm/schema'
import { cx } from '../../ui/cx'
import styles from './ToneBadge.module.css'

export interface ToneBadgeProps {
  tone: Tone
  /** Whether to layer the Okabe-Ito tone color on top of the name. */
  toneColors: boolean
  className?: string
}

/**
 * Colour + tone name (docs/plans/P0.md §4.3). The name is always rendered as text -
 * never relies on colour alone - so it stays legible with `toneColors`
 * toggled off (`.claude/rules/ui.md` accessibility requirement).
 */
export function ToneBadge({ tone, toneColors, className }: ToneBadgeProps) {
  return (
    <span
      className={cx(styles.badge, className)}
      data-tone={tone}
      data-colored={toneColors || undefined}
    >
      {tone}
    </span>
  )
}
