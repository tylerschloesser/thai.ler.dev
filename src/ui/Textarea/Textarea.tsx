import * as React from 'react'
import { cx } from '../cx'
import styles from './Textarea.module.css'

// Base UI has no Textarea primitive - this wraps a native <textarea>,
// styled with tokens, with the same data-* affordances used elsewhere
// (aria-invalid is what Field.Root/validation drives; we style off it
// directly since there's no Base UI state attribute for a plain textarea).
export interface TextareaProps extends Omit<
  React.ComponentPropsWithoutRef<'textarea'>,
  'className'
> {
  className?: string
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cx(styles.textarea, className)}
        {...props}
      />
    )
  },
)
