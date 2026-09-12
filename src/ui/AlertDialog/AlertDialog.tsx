import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { AlertDialog as Base } from '@base-ui/react/alert-dialog'
import { cx } from '../cx'
import styles from './AlertDialog.module.css'

export const Root = Base.Root
export const Trigger = Base.Trigger
// No default styling: compose with `render={<Button variant="..." />}` for
// both the Cancel and the destructive Confirm action (attach an onClick to
// the latter - Base.Close still closes the dialog after it runs).
export const Close = Base.Close

export interface PopupProps extends Omit<
  ComponentPropsWithoutRef<typeof Base.Popup>,
  'className'
> {
  className?: string
  children?: ReactNode
}

/** An alert dialog cannot be dismissed by outside click or Escape by
 * default in the same way a Dialog can - Base UI still wires Escape for
 * alert dialogs, but there's no click-outside dismissal, which is the
 * point (it's for confirmations, e.g. delete). */
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

export function Actions({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return <div className={cx(styles.actions, className)} {...props} />
}
