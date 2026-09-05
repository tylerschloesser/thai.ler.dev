import { Button as BaseButton } from '@base-ui/react/button'
import { cx } from '../../lib/cx.ts'
import styles from './Button.module.css'

export type ButtonVariant = 'solid' | 'soft' | 'quiet'

export type ButtonProps = BaseButton.Props & {
  variant?: ButtonVariant
}

/**
 * Base UI's Button with our styling. It handles the disabled/focus semantics
 * that a bare <button> gets wrong (notably `focusableWhenDisabled`), so reach
 * for this rather than a raw element.
 */
export function Button({ className, variant = 'soft', ...props }: ButtonProps) {
  // Base UI's className may be a callback over component state, so resolve it
  // per-state rather than flattening it to a string.
  return (
    <BaseButton
      {...props}
      data-variant={variant}
      className={(state) =>
        cx(styles.button, typeof className === 'function' ? className(state) : className)
      }
    />
  )
}
