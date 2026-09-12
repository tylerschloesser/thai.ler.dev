import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Tooltip as Base } from '@base-ui/react/tooltip'
import { cx } from '../cx'
import styles from './Tooltip.module.css'

export const Provider = Base.Provider
export const Root = Base.Root
export const Trigger = Base.Trigger

export interface PopupProps extends Omit<
  ComponentPropsWithoutRef<typeof Base.Positioner>,
  'className'
> {
  className?: string
  children?: ReactNode
}

export function Popup({
  className,
  children,
  side = 'top',
  sideOffset = 6,
  ...positionerProps
}: PopupProps) {
  return (
    <Base.Portal>
      <Base.Positioner side={side} sideOffset={sideOffset} {...positionerProps}>
        <Base.Popup className={cx(styles.popup, className)}>
          <Base.Arrow className={styles.arrow} />
          {children}
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  )
}
