import { useEffect } from 'react'

// Registers a `beforeunload` warning while `dirty` is true. Browsers ignore
// the custom message and show their own generic prompt — the only thing we
// control is whether the prompt fires at all. Multiple components can
// activate it independently; the listener is keyed per call so they don't
// stomp each other.
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Some browsers still require a string assignment to trigger the prompt
      // even though the spec deprecated `returnValue`. Without this, Chrome
      // silently skips the dialog.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
}
