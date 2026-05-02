import React, { useEffect } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

const styles = {
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    iconClassName: 'text-emerald-600',
  },
  error: {
    icon: AlertCircle,
    className: 'border-red-200 bg-red-50 text-red-800',
    iconClassName: 'text-red-600',
  },
  info: {
    icon: Info,
    className: 'border-blue-200 bg-blue-50 text-blue-900',
    iconClassName: 'text-primary',
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

  const tone = styles[toast.type] || styles.info
  const Icon = tone.icon

  return (
    <div className="pointer-events-none fixed right-5 top-16 z-50 w-[min(380px,calc(100vw-2.5rem))]">
      <div className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-card ${tone.className}`}>
        <Icon size={17} className={`mt-0.5 shrink-0 ${tone.iconClassName}`} />
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
          className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
