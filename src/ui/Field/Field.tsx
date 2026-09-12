import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Field as Base } from '@base-ui/react/field'
import { cx } from '../cx'
import styles from './Field.module.css'

export interface RootProps extends Omit<
  ComponentPropsWithoutRef<typeof Base.Root>,
  'className'
> {
  className?: string
  children?: ReactNode
}

export function Root({ className, ...props }: RootProps) {
  return <Base.Root className={cx(styles.root, className)} {...props} />
}

export function Label(props: ComponentPropsWithoutRef<typeof Base.Label>) {
  return <Base.Label className={styles.label} {...props} />
}

export function Description(
  props: ComponentPropsWithoutRef<typeof Base.Description>,
) {
  return <Base.Description className={styles.description} {...props} />
}

export function Error(props: ComponentPropsWithoutRef<typeof Base.Error>) {
  return <Base.Error className={styles.error} {...props} />
}
