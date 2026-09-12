import type { ReactNode } from 'react'
import { Toast as Base } from '@base-ui/react/toast'
import styles from './Toast.module.css'

/** Add/close/update toasts from any component beneath <ToastProvider>. */
export const useToast = Base.useToastManager

function ToastList() {
  const { toasts } = useToast()
  return (
    <>
      {toasts.map((toast) => (
        <Base.Root key={toast.id} toast={toast} className={styles.toast}>
          {toast.title !== undefined && <Base.Title className={styles.title} />}
          {toast.description !== undefined && (
            <Base.Description className={styles.description} />
          )}
          <Base.Close className={styles.close} aria-label="Dismiss" />
        </Base.Root>
      ))}
    </>
  )
}

export interface ToastProviderProps {
  children?: ReactNode
}

/** Mount once near the app root (src/main.tsx). Renders the toast viewport
 * portaled to <body>; call `useToast()` anywhere beneath it to add a toast:
 * `useToast().add({ title: 'Saved', type: 'success' })`. `type` drives
 * `data-type` on each part for styling (see Toast.module.css). */
export function ToastProvider({ children }: ToastProviderProps) {
  return (
    <Base.Provider>
      {children}
      <Base.Portal>
        <Base.Viewport className={styles.viewport}>
          <ToastList />
        </Base.Viewport>
      </Base.Portal>
    </Base.Provider>
  )
}
