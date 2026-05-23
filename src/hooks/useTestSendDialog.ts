import { useState } from 'react'
import { sendTestEmail } from '../lib/api'
import { useToast } from '../contexts/ToastContext'
import { actionKey, runExclusive } from '../lib/pendingActions'

// Owns the "Send test" dialog on a draft: which emailId is being tested,
// the recipient input value, and the in-flight busy flag. Extracted from
// DraftsTab where these three pieces of state interleaved with the
// surrounding draft-list state for no good reason — the dialog is
// self-contained and only needs the user's email as a default seed
// when opening.
//
// busy is set across the network call so the caller's close affordance
// can disable itself. The hook owns the toast feedback so callers don't
// need to thread showToast in.

interface UseTestSendDialogOptions {
  // Seeded into `recipient` when openFor() fires. Lets the dialog
  // pre-fill the user's own address when they click "send test" — they
  // can edit before submitting.
  defaultRecipient: string | undefined
}

export function useTestSendDialog({ defaultRecipient }: UseTestSendDialogOptions) {
  const { showToast } = useToast()
  const [emailId, setEmailId] = useState<string | null>(null)
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState(false)

  const openFor = (id: string) => {
    setRecipient(defaultRecipient || '')
    setEmailId(id)
  }

  const close = () => {
    if (busy) return
    setEmailId(null)
  }

  const submit = async () => {
    if (!emailId) return
    setBusy(true)
    try {
      await runExclusive(
        actionKey('test-send-email', emailId, recipient.trim().toLowerCase()),
        () => sendTestEmail(emailId, recipient),
      )
      showToast({
        type: 'success',
        title: 'Test email sent',
        message: `Delivered to ${recipient.trim().toLowerCase()}`,
      })
      setEmailId(null)
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Test send failed',
        message: (err as Error)?.message || 'Try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  return {
    isOpen: emailId !== null,
    emailId,
    recipient,
    busy,
    setRecipient,
    openFor,
    close,
    submit,
  }
}
