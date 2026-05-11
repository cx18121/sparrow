import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import ToastViewport, { type ToastInput, type ToastItem } from '../components/ui/Toast'

type ShowToast = (toast: ToastInput) => string
type DismissToast = (id: string) => void

interface ToastApi {
  showToast: ShowToast
  dismissToast: DismissToast
  reportError: (title: string, err?: unknown) => string
}

const ToastContext = createContext<ToastApi | null>(null)

// Cap the number of stacked toasts. The viewport sits in the top-right corner
// and stacking more than ~3 starts to occlude page content; older toasts
// drop off the back of the queue when a 4th arrives.
const MAX_TOASTS = 3

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idCounter = useRef(0)

  const dismissToast = useCallback<DismissToast>((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback<ShowToast>((toast) => {
    idCounter.current += 1
    const id = `t${idCounter.current}`
    const item: ToastItem = { ...toast, id }
    setToasts((prev) => {
      const next = [...prev, item]
      // Cap stack size by dropping the oldest *non-pinned* toast. Pinned
      // toasts (e.g. a deferred-send Undo) are never auto-evicted — losing
      // them would silently strip a user-facing cancel affordance.
      if (next.length <= MAX_TOASTS) return next
      const overflow = next.length - MAX_TOASTS
      const trimmed: ToastItem[] = []
      let dropped = 0
      for (const t of next) {
        if (dropped < overflow && !t.pinned) { dropped++; continue }
        trimmed.push(t)
      }
      return trimmed
    })
    return id
  }, [])

  const reportError = useCallback(
    (title: string, err?: unknown) => {
      console.error(title, err)
      return showToast({
        type: 'error',
        title,
        message: (err as any)?.message || 'Please try again.',
      })
    },
    [showToast],
  )

  const api = useMemo<ToastApi>(
    () => ({ showToast, dismissToast, reportError }),
    [showToast, dismissToast, reportError],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>')
  }
  return ctx
}

export type { ToastInput, ToastItem }
