import React, { useEffect } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { TOAST_TONES, getStatusTone } from './statusTokens'

const styles = {
  success: {
    icon: CheckCircle2,
  },
  error: {
    icon: AlertCircle,
  },
  info: {
    icon: Info,
  },
}

export default function Toast({ toast, onClose, duration = 4500 }) {
  const effectiveDuration = toast?.duration ?? duration
  useEffect(() => {
    if (!toast || !effectiveDuration) return
    const timer = window.setTimeout(onClose, effectiveDuration)
    return () => window.clearTimeout(timer)
  }, [effectiveDuration, onClose, toast])

  if (!toast) return null

  const style = styles[toast.type] || styles.info
  const tone = getStatusTone(TOAST_TONES[toast.type] || 'info')
  const Icon = style.icon

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed right-5 top-16 z-50 w-[min(380px,calc(100vw-2.5rem))]"
    >
      <div className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-modal animate-toast-in ${tone.border} ${tone.surface} ${tone.textStrong}`}>
        <Icon size={17} className={`mt-0.5 shrink-0 ${tone.icon}`} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{toast.title}</p>
          {toast.message && <p className="mt-0.5 text-xs leading-5 opacity-80">{toast.message}</p>}
          {toast.action && (
            <button
              type="button"
              onClick={toast.action.onClick}
              className="mt-2 text-xs font-semibold underline-offset-2 hover:underline"
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="shrink-0 -m-1 rounded-lg p-2 opacity-70 transition-opacity hover:opacity-100"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
