import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export default function Modal({ open, onClose, title, children, size = 'md' }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<Element | null>(null)
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`)

  // Keyboard dismiss
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Focus management: save opener, focus into modal, restore on close
  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      first?.focus()
    } else {
      ;(openerRef.current as HTMLElement | null)?.focus()
      openerRef.current = null
    }
  }, [open])

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
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-dark/40" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        className={`relative max-h-[92vh] w-full ${sizeClass} overflow-hidden rounded-t-[24px] border border-slate-100 bg-white shadow-modal animate-fade-in sm:rounded-[30px]`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <h2 id={titleId.current} className="text-base font-semibold text-dark">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn-ghost -mr-1 p-2.5 text-muted"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[calc(92vh-56px)] overflow-y-auto sm:max-h-[80vh]">
          {children}
        </div>
      </div>
    </div>
  )
}
