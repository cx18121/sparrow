import { useState } from 'react'

export interface ToastState {
  type: 'success' | 'error' | 'info' | 'warning'
  title: string
  message?: string
  duration?: number
  action?: { label: string; onClick: () => void } | null
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)

  const reportError = (title: string, err?: unknown) => {
    console.error(title, err)
    setToast({ type: 'error', title, message: (err as any)?.message || 'Please try again.' })
  }

  return { toast, setToast, reportError }
}
