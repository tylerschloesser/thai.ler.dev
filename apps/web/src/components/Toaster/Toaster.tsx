import { Toast } from '@base-ui/react/toast'
import styles from './Toaster.module.css'

/**
 * Where a permanently-rejected write surfaces.
 *
 * A failing *row* shows its error inline and offers Retry; this is for the
 * other case — the write itself was refused, so there is no row to attach the
 * message to and the optimistic one has already rolled back.
 */
export function Toaster() {
  return (
    <Toast.Portal>
      <Toast.Viewport className={styles.viewport}>
        <ToastList />
      </Toast.Viewport>
    </Toast.Portal>
  )
}

function ToastList() {
  const { toasts } = Toast.useToastManager()

  return toasts.map((toast) => (
    <Toast.Root key={toast.id} toast={toast} className={styles.toast}>
      <Toast.Title className={styles.title} />
      <Toast.Description className={styles.description} />
      <Toast.Close className={styles.close} aria-label="Dismiss">
        ✕
      </Toast.Close>
    </Toast.Root>
  ))
}
