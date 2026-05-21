import { useCallback, useEffect } from 'react'
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom'

// Module-level counter of registered dirty surfaces so non-React callsites
// (App.handleTabChange, Sidebar nav handlers) can ask "is anything unsaved
// right now?" without consuming a Context. Each useUnsavedChanges() call
// increments on mount-while-dirty and decrements on cleanup, so the sum
// reflects the union of all active dirty registrations.
let dirtyCount = 0

export function isAnythingDirty(): boolean {
  return dirtyCount > 0
}

// Registers a `beforeunload` warning while `dirty` is true. Browsers ignore
// the custom message and show their own generic prompt — the only thing we
// control is whether the prompt fires at all. Multiple components can
// activate it independently; the listener is keyed per call so they don't
// stomp each other.
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    dirtyCount += 1
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Some browsers still require a string assignment to trigger the prompt
      // even though the spec deprecated `returnValue`. Without this, Chrome
      // silently skips the dialog.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      dirtyCount -= 1
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [dirty])
}

// useNavigate that confirms before navigating when any surface has unsaved
// changes. BrowserRouter v6 doesn't ship `useBlocker` (data-router only), so
// we intercept at the callsite instead. Browser back/forward and direct
// `useNavigate` calls in components that don't use this hook are still
// unguarded — they're rarer paths and a full fix needs a router migration.
export function useGuardedNavigate(): (to: To, options?: NavigateOptions) => void {
  const navigate = useNavigate()
  return useCallback((to, options) => {
    if (isAnythingDirty() && !window.confirm('You have unsaved changes. Leave anyway?')) return
    navigate(to, options)
  }, [navigate])
}
