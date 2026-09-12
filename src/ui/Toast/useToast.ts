import { Toast as Base } from '@base-ui/react/toast'

/**
 * Add/close/update toasts from any component beneath <ToastProvider>:
 * `useToast().add({ title: 'Saved', type: 'success' })`.
 *
 * Lives in its own module rather than beside the provider so Toast.tsx
 * exports only components - a file that mixes components with other exports
 * breaks React Fast Refresh (oxlint react/only-export-components).
 */
export const useToast = Base.useToastManager
