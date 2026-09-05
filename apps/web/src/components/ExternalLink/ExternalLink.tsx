import type { ReactNode } from 'react'
import styles from './ExternalLink.module.css'

interface ExternalLinkProps {
  href: string
  /** An <svg> or <img>; sized by the stylesheet, so pass it bare. */
  icon: ReactNode
  children: string
}

/**
 * Base UI has no link primitive — an anchor is already the right element — so
 * this is native HTML with the two things a bare `target="_blank"` misses:
 * `rel="noreferrer"`, and telling screen reader users where the link goes.
 */
export function ExternalLink({ href, icon, children }: ExternalLinkProps) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={styles.link}>
      {icon}
      {children}
      <span className={styles.newTabHint}> (opens in a new tab)</span>
    </a>
  )
}
