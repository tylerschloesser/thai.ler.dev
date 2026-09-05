import { Toast } from '@base-ui/react/toast'
import { useEffect } from 'react'
import { onWriteError } from './sync.ts'

/**
 * Routes permanently-failed writes to a toast.
 *
 * Mounted once at the root: a write can outlive the component that started it
 * (that is the whole point of a durable outbox), so its failure has to surface
 * somewhere that is still on screen.
 */
export function useWriteErrors(): void {
  const toast = Toast.useToastManager()

  useEffect(
    () =>
      onWriteError((error) => {
        toast.add({ title: 'Change not saved', description: error.message })
      }),
    [toast],
  )
}
