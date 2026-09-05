import type { ErrorComponentProps } from '@tanstack/react-router'
import { Link, useRouter } from '@tanstack/react-router'
import { Button } from '../Button/Button.tsx'
import styles from './Boundary.module.css'

/**
 * The three route-level states, kept together because they are one design
 * problem: what the frame shows when the content underneath is not there.
 */

export function RoutePending() {
  return (
    <output className={styles.root} aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      Loading
    </output>
  )
}

export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter()

  return (
    <div className={styles.root} role="alert">
      <p className={styles.title}>Something went wrong</p>
      <p className={styles.detail}>{messageOf(error)}</p>
      <Button onClick={() => void router.invalidate()}>Try again</Button>
    </div>
  )
}

export function RouteNotFound() {
  return (
    <div className={styles.root}>
      <p className={styles.title}>Not found</p>
      <p className={styles.detail}>That page doesn&rsquo;t exist.</p>
      <Link to="/" className={styles.link}>
        Back to translations
      </Link>
    </div>
  )
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'An unexpected error occurred.'
}
