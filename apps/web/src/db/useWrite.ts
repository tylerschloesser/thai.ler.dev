import { Toast } from '@base-ui/react/toast'
import { useCallback, useState } from 'react'

/**
 * Runs a write and turns a rejection into a toast.
 *
 * Writes resolve when the server confirms and reject only when the write is
 * permanently refused — by then TanStack DB has already rolled the optimistic
 * state back, so there is nothing to undo here, only something to say.
 *
 * Note what this hook does *not* track: whether the model is finished. That
 * lives on the row, not in React, so it survives this component unmounting.
 */
export function useWrite(): {
  run: (write: () => Promise<unknown>) => Promise<void>
  busy: boolean
} {
  const toast = Toast.useToastManager()
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (write: () => Promise<unknown>) => {
      setBusy(true)
      try {
        await write()
      } catch (error) {
        toast.add({
          title: 'Change not saved',
          description: error instanceof Error ? error.message : 'Something went wrong.',
        })
      } finally {
        setBusy(false)
      }
    },
    [toast],
  )

  return { run, busy }
}
