import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Select as Base } from '@base-ui/react/select'
import { cx } from '../cx'
import styles from './Select.module.css'

export const Root = Base.Root

export interface TriggerProps extends Omit<
  ComponentPropsWithoutRef<typeof Base.Trigger>,
  'className'
> {
  className?: string
  children?: ReactNode
}

export function Trigger({ className, children, ...props }: TriggerProps) {
  return (
    <Base.Trigger className={cx(styles.trigger, className)} {...props}>
      {children}
      <Base.Icon className={styles.icon}>
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path
            d="M1 1l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </Base.Icon>
    </Base.Trigger>
  )
}

export const Value = Base.Value

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
  sideOffset = 4,
  ...positionerProps
}: PopupProps) {
  return (
    <Base.Portal>
      <Base.Positioner sideOffset={sideOffset} {...positionerProps}>
        <Base.Popup className={cx(styles.popup, className)}>
          <Base.ScrollUpArrow className={styles.scrollArrow} />
          <Base.List className={styles.list}>{children}</Base.List>
          <Base.ScrollDownArrow className={styles.scrollArrow} />
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  )
}

export interface ItemProps extends Omit<
  ComponentPropsWithoutRef<typeof Base.Item>,
  'className'
> {
  className?: string
  children?: ReactNode
}

export function Item({ className, children, ...props }: ItemProps) {
  return (
    <Base.Item className={cx(styles.item, className)} {...props}>
      <Base.ItemIndicator className={styles.indicator}>
        <svg width="10" height="8" viewBox="0 0 10 8" aria-hidden="true">
          <path
            d="M1 4l3 3 5-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </Base.ItemIndicator>
      <Base.ItemText className={styles.itemText}>{children}</Base.ItemText>
    </Base.Item>
  )
}
