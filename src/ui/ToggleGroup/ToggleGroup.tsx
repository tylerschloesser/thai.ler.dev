import { ToggleGroup as Base } from '@base-ui/react/toggle-group'
import type { ToggleGroup as ToggleGroupNamespace } from '@base-ui/react/toggle-group'
import { cx } from '../cx'
import styles from './ToggleGroup.module.css'

export interface ToggleGroupProps<Value extends string = string> extends Omit<
  ToggleGroupNamespace.Props<Value>,
  'className'
> {
  className?: string
}

export function ToggleGroup<Value extends string = string>({
  className,
  ...props
}: ToggleGroupProps<Value>) {
  return <Base className={cx(styles.group, className)} {...props} />
}
