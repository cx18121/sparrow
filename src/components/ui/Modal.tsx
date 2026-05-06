import React, { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

export default function Modal({ open, onClose, title, children, size = 'md' }) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  // Keep onClose in a ref so the keyboard handler always has the latest
  // version without triggering the focus-management effect on every render.
  // Without this, an inline `() => setState(false)` prop recreates each
  // render, re-fires the effect, and steals focus from the active input.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const getFocusable = (): HTMLElement[] => {
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      return Array.from(nodes ?? []).filter(
        (el): el is HTMLElement => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
      )
    }
    const focusFirstElement = () => {
      const focusable = getFocusable()
      const preferred = dialogRef.current?.querySelector<HTMLElement>('[autofocus]')
      ;(preferred || focusable[0] || dialogRef.current)?.focus()
    }
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const focusable = getFocusable()
      if (focusable.length === 0) {
        e.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    requestAnimationFrame(focusFirstElement)
    document.addEventListener('keydown', handler)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handler)
      previouslyFocused?.focus()
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
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
    >
      <div className="absolute inset-0 bg-dark/35 animate-backdrop-in" aria-hidden="true" onClick={onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`relative max-h-[92vh] w-full ${sizeClass} overflow-hidden rounded-t-3xl border border-warm-200 bg-panel shadow-modal animate-modal-rise sm:rounded-2xl`}
      >
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
