import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Popover as Base } from '@base-ui/react/popover'
import { cx } from '../cx'
import styles from './Popover.module.css'

export const Root = Base.Root
export const Trigger = Base.Trigger

export interface PopupProps extends Omit<
  ComponentPropsWithoutRef<typeof Base.Positioner>,
  'className'
> {
  className?: string
  children?: ReactNode
}

/** Positioner + popup + arrow, portaled to <body>. No backdrop - popovers
 * don't block interaction with the rest of the page. */
export function Popup({
  className,
  children,
  side = 'bottom',
  sideOffset = 8,
  ...positionerProps
}: PopupProps) {
  return (
    <Base.Portal>
      <Base.Positioner
        className={styles.positioner}
        side={side}
        sideOffset={sideOffset}
        {...positionerProps}
      >
        <Base.Popup className={cx(styles.popup, className)}>
          <Base.Arrow className={styles.arrow} />
          {children}
        </Base.Popup>
      </Base.Positioner>
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

// Unstyled - compose with `render={<Button variant="ghost" />}` for a
// labeled action.
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
