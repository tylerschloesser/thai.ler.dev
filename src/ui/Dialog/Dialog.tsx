import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Dialog as Base } from '@base-ui/react/dialog'
import { cx } from '../cx'
import styles from './Dialog.module.css'

export const Root = Base.Root
export const Trigger = Base.Trigger

export interface PopupProps extends Omit<
  ComponentPropsWithoutRef<typeof Base.Popup>,
  'className'
> {
  className?: string
  children?: ReactNode
}

/** A backdrop + popup, portaled to <body>. Covers the plumbing every dialog
 * needs so call sites only describe their content. */
export function Popup({ className, children, ...props }: PopupProps) {
  return (
    <Base.Portal>
      <Base.Backdrop className={styles.backdrop} />
      <Base.Popup className={cx(styles.popup, className)} {...props}>
        {children}
      </Base.Popup>
    </Base.Portal>
  )
}

export function Title(props: ComponentPropsWithoutRef<typeof Base.Title>) {
  return <Base.Title className={styles.title} {...props} />
}

export function Description(
  props: ComponentPropsWithoutRef<typeof Base.Description>,
) {
  return <Base.Description className={styles.description} {...props} />
}

// Unstyled - compose with `render={<Button variant="ghost" />}` etc. for a
// labeled action (Cancel/Save).
export const Close = Base.Close

/** The common small "x" dismiss button, positioned in the popup's corner. */
export function IconClose(
  props: Omit<ComponentPropsWithoutRef<typeof Base.Close>, 'className'>,
) {
  return (
    <Base.Close className={styles.iconClose} aria-label="Close" {...props}>
      &times;
    </Base.Close>
  )
}
