import { Toggle as Base } from '@base-ui/react/toggle'
import type { Toggle as ToggleNamespace } from '@base-ui/react/toggle'
import { cx } from '../cx'
import styles from './Toggle.module.css'

export interface ToggleProps<Value extends string = string> extends Omit<
  ToggleNamespace.Props<Value>,
  'className'
> {
  className?: string
}

export function Toggle<Value extends string = string>({
  className,
  ...props
}: ToggleProps<Value>) {
  return <Base className={cx(styles.toggle, className)} {...props} />
}
