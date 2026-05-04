import React from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import Modal from './Modal'

export default function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', danger = true, confirmDisabled = false }) {
  const Icon = danger ? AlertTriangle : CheckCircle2
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="px-5 py-5">
        <div className="flex gap-3">
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${danger ? 'bg-red-50 text-red-600' : 'bg-primary/10 text-primary'}`}>
            <Icon size={17} />
          </span>
          <p className="text-sm leading-6 text-muted">{message}</p>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => { onConfirm(); onClose() }}
            disabled={confirmDisabled}
            className={`${danger ? 'btn-danger' : 'btn-primary'} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
