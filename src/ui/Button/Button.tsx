import * as React from 'react'
import { Button as BaseButton } from '@base-ui/react/button'
import type { Button as ButtonNamespace } from '@base-ui/react/button'
import { cx } from '../cx'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends Omit<ButtonNamespace.Props, 'className'> {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}

export const Button = React.forwardRef<HTMLElement, ButtonProps>(
  function Button(
    { variant = 'primary', size = 'md', className, ...props },
    ref,
  ) {
    return (
      <BaseButton
        ref={ref}
        className={cx(styles.button, styles[variant], styles[size], className)}
        {...props}
      />
    )
  },
)
