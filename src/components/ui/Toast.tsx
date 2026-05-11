import { useEffect, useRef } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { TOAST_TONES, getStatusTone } from './statusTokens'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastInput {
  type: ToastType
  title: string
  message?: string
  // 0 / null pins the toast until dismissed. Undefined uses the default.
  duration?: number | null
  action?: { label: string; onClick: () => void } | null
}

export interface ToastItem extends ToastInput {
  id: string
}

const ICONS: Record<ToastType, React.ComponentType<{ size?: number; className?: string }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

const DEFAULT_DURATION = 4500

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem
  onDismiss: (id: string) => void
}) {
  const dismiss = () => onDismiss(toast.id)

  // Hover pauses the auto-dismiss timer — common pattern for stacked toasts
  // so a reader can finish a longer message without it disappearing mid-read.
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const duration = toast.duration === undefined ? DEFAULT_DURATION : toast.duration
    if (!duration) return
    const el = containerRef.current
    let timer = window.setTimeout(dismiss, duration)
    if (!el) return () => window.clearTimeout(timer)
    let remaining = duration
    let startedAt = Date.now()
    const pause = () => {
      window.clearTimeout(timer)
      remaining -= Date.now() - startedAt
    }
    const resume = () => {
      if (remaining <= 0) { dismiss(); return }
      startedAt = Date.now()
      timer = window.setTimeout(dismiss, remaining)
    }
    el.addEventListener('mouseenter', pause)
    el.addEventListener('mouseleave', resume)
    return () => {
      window.clearTimeout(timer)
      el.removeEventListener('mouseenter', pause)
      el.removeEventListener('mouseleave', resume)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id, toast.duration])

  const Icon = ICONS[toast.type] || ICONS.info
  const tone = getStatusTone(TOAST_TONES[toast.type] || 'info')

  return (
    <div
      ref={containerRef}
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-modal animate-toast-in ${tone.border} ${tone.surface} ${tone.textStrong}`}
    >
      <Icon size={17} className={`mt-0.5 shrink-0 ${tone.icon}`} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{toast.title}</p>
        {toast.message && (
          <p className="mt-0.5 text-xs leading-5 opacity-80">{toast.message}</p>
        )}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action!.onClick()
              dismiss()
            }}
            className="mt-2 text-xs font-semibold underline-offset-2 hover:underline"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 -m-1 rounded-lg p-2 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-1"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export default function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null
  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed right-5 top-16 z-50 flex w-[min(380px,calc(100vw-2.5rem))] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
