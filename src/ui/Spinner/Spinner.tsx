import { cx } from '../cx'
import styles from './Spinner.module.css'

export interface SpinnerProps {
  /** @default 'md' */
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Accessible label; the spinner itself is aria-hidden. */
  label?: string
}

// No Base UI primitive for this - a plain CSS-animated SVG.
export function Spinner({
  size = 'md',
  className,
  label = 'Loading',
}: SpinnerProps) {
  return (
    <span role="status" className={cx(styles.wrapper, className)}>
      <svg
        className={cx(styles.spinner, styles[size])}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="56"
          strokeDashoffset="42"
        />
      </svg>
      <span className={styles.srOnly}>{label}</span>
    </span>
  )
}
