import { useEffect, useRef } from 'react'
import { useToast } from '../contexts/ToastContext'

// Owns the 5s-undo window for a deferred send: opens the pinned "Sending in
// 5s… (Undo)" toast, runs the timer, and dismisses the toast as it fires so
// the Undo button can't outlive its own cancel window. The actual send loop
// stays at the call site; onFire(ids) is the only hook into "the user
// committed." The caller decides which of those ids are still alive — drafts
// edited or deleted during the undo window must not resurrect themselves.

interface UsePendingSendQueueOptions {
  onFire: (ids: string[]) => void
  // Resolved per scheduleSend so the title can reflect the latest draft
  // state (e.g. recipient-name lookup at queue time, not at hook-init time).
  toastTitleFor: (ids: string[]) => string
  delayMs?: number
}

interface PendingSendQueue {
  // Calling again before the timer fires cancels the prior schedule first.
  scheduleSend: (ids: string[]) => void
  // Safe to call when nothing is pending.
  cancelPendingSend: () => void
}

export function usePendingSendQueue(
  options: UsePendingSendQueueOptions,
): PendingSendQueue {
  const { onFire, toastTitleFor, delayMs = 5000 } = options
  const { showToast, dismissToast } = useToast()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastIdRef = useRef<string | null>(null)

  // Only onFire needs the latest-render binding — it's the one option called
  // from inside the setTimeout, so the consumer's most recent closure (e.g.
  // a freshly-bound markSent against current draft state) must win over the
  // one captured at schedule time. toastTitleFor and delayMs are read
  // synchronously in scheduleSend, so their per-call values are already
  // correct without indirection.
  const onFireRef = useRef(onFire)
  onFireRef.current = onFire

  const cancelPendingSend = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (toastIdRef.current) {
      dismissToast(toastIdRef.current)
      toastIdRef.current = null
    }
  }

  const scheduleSend = (ids: string[]) => {
    cancelPendingSend()
    toastIdRef.current = showToast({
      type: 'info',
      title: toastTitleFor(ids),
      message: '',
      duration: delayMs + 500,
      // Pinned: this toast carries the only Undo affordance. If three other
      // toasts arrive during the window, eviction would otherwise drop it
      // and strand the user.
      pinned: true,
      action: { label: 'Undo', onClick: cancelPendingSend },
    })
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      // Dismiss our own toast as the send fires — hover-pause means the
      // toast might otherwise stay visible past the timer with a button
      // that no longer cancels anything.
      if (toastIdRef.current) {
        dismissToast(toastIdRef.current)
        toastIdRef.current = null
      }
      onFireRef.current(ids)
    }, delayMs)
  }

  // On unmount: clear the timer AND dismiss the in-flight toast. Without
  // the dismiss, an unmount mid-window leaves a "Sending in 5s… (Undo)"
  // toast stranded — the timer is cancelled (no send fires) but the toast
  // still implies a send is imminent, with an Undo button that no longer
  // corresponds to anything.
  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (toastIdRef.current) {
      dismissToast(toastIdRef.current)
      toastIdRef.current = null
    }
  // dismissToast is stable across renders (useCallback in ToastContext),
  // so empty deps is correct — we want exactly one cleanup, on unmount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { scheduleSend, cancelPendingSend }
}
