import { useEffect, useRef } from 'react'
import { useToast } from '../contexts/ToastContext'

// Owns the 5-second-undo window for a deferred send: opens the pinned "Sending
// in 5s… (Undo)" toast, runs the timer, and dismisses the toast as the timer
// fires so the Undo button can't outlive its own cancel window. The actual
// send loop stays at the call site — this hook only manages the deferral and
// the user's chance to cancel it.
//
// Extracted from DraftsTab.tsx where the timer + toast + ref-mirror dance was
// interleaved with unrelated concerns. The bug history that motivated the
// pattern (bug 04: drafts edited or deleted during the undo window must not
// resurrect themselves at fire time) is still the caller's responsibility —
// the hook calls onFire(ids) and lets the caller decide which of those ids
// are still alive.

interface UsePendingSendQueueOptions {
  // Fired after the undo window elapses with the original ids. Callers
  // typically filter against their live draft list before doing the work
  // — the hook intentionally doesn't know what "alive" means.
  onFire: (ids: string[]) => void
  // Title to show on the "Sending in 5s… (Undo)" toast. Called per
  // scheduleSend, so it can reflect the latest draft state (e.g. recipient
  // name lookups).
  toastTitleFor: (ids: string[]) => string
  // Override the default 5000ms window. Test-only knob.
  delayMs?: number
}

interface PendingSendQueue {
  // Open the pinned undo toast and arm the timer. Calling again before the
  // timer fires cancels the prior schedule first.
  scheduleSend: (ids: string[]) => void
  // Clear the timer and dismiss the toast. Safe to call when nothing is
  // pending.
  cancelPendingSend: () => void
}

export function usePendingSendQueue(
  options: UsePendingSendQueueOptions,
): PendingSendQueue {
  const { showToast, dismissToast } = useToast()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastIdRef = useRef<string | null>(null)

  // Mirror options through a ref so a closure captured at schedule time still
  // calls the latest onFire / toastTitleFor — the consumer often rebinds
  // these every render against fresh draft state.
  const optionsRef = useRef(options)
  optionsRef.current = options

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
    const delayMs = optionsRef.current.delayMs ?? 5000
    toastIdRef.current = showToast({
      type: 'info',
      title: optionsRef.current.toastTitleFor(ids),
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
      optionsRef.current.onFire(ids)
    }, delayMs)
  }

  // Clear any pending timer when the consumer unmounts so a deferred send
  // doesn't fire against torn-down state.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return { scheduleSend, cancelPendingSend }
}
