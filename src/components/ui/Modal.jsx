import React, { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ open, onClose, title, children, size = 'md' }) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
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
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-[rgba(11,29,51,0.28)] backdrop-blur-md" />
      <div className={`relative max-h-[92vh] w-full ${sizeClass} overflow-hidden rounded-t-[24px] border border-white/75 bg-white/95 shadow-modal backdrop-blur-xl animate-fade-in sm:rounded-[30px]`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="text-base font-semibold text-dark">{title}</h2>
          <button onClick={onClose} className="btn-ghost p-2 text-muted">
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
