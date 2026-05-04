import React, { useEffect, useId } from 'react'
import { X } from 'lucide-react'

export default function Modal({ open, onClose, title, children, size = 'md' }) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handler)
    }
  }, [open, onClose])

  if (!open) return null

  const sizeClass = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-6xl',
  }[size] || 'max-w-lg'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-dark/35 animate-backdrop-in" />
      <div className={`relative max-h-[92vh] w-full ${sizeClass} overflow-hidden rounded-t-3xl border border-warm-200 bg-panel shadow-modal animate-modal-rise sm:rounded-2xl`}>
        <div className="flex min-h-14 items-center justify-between border-b border-warm-200 px-4 py-3 sm:px-5">
          <h2 id={titleId} className="text-base font-semibold text-dark">{title}</h2>
          <button onClick={onClose} className="btn-ghost h-8 w-8 p-0 text-muted" aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[calc(92vh-56px)] overflow-y-auto sm:max-h-[78vh]">
          {children}
        </div>
      </div>
    </div>
  )
}
