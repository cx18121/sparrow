import React from 'react'
import Modal from './Modal'

export default function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', danger = true, confirmDisabled = false }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="px-6 py-4">
        <p className="text-sm text-muted">{message}</p>
        <div className="flex justify-end gap-2 mt-6">
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
