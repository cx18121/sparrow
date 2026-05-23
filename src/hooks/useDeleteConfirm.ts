import { useState } from 'react'

// Modal-state machine for "delete N drafts" confirm flow. The actual
// delete logic (optimistic update, snapshot revert on failure,
// next-preview selection, selection-clear) lives at the call site
// because it's deeply tied to the parent's draft-list state. This
// hook just owns the modal: which ids are pending confirm, the
// in-flight busy flag, and the open/close transitions.

interface UseDeleteConfirmOptions<T> {
  // Fired when the user clicks Confirm. Hook flips `busy` true,
  // awaits onConfirm, then closes the modal — whether onConfirm
  // throws or returns. Caller surfaces error toasts inside onConfirm.
  onConfirm: (target: T) => Promise<void>
}

export function useDeleteConfirm<T>({ onConfirm }: UseDeleteConfirmOptions<T>) {
  const [target, setTarget] = useState<T | null>(null)
  const [busy, setBusy] = useState(false)

  const openFor = (next: T) => setTarget(next)
  const close = () => { if (!busy) setTarget(null) }

  const run = async () => {
    if (target === null) return
    setBusy(true)
    try {
      await onConfirm(target)
    } finally {
      setBusy(false)
      setTarget(null)
    }
  }

  return {
    target,
    isOpen: target !== null,
    busy,
    openFor,
    close,
    run,
  }
}
