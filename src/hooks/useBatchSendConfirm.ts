import { useState } from 'react'
import { fetchSentTodayCount } from '../lib/api'

// Modal-state machine for the batch-send confirm flow + daily-limit
// lookup. The actual send loop (markSent — cancellable, per-id delay,
// per-failure tracking) stays at the call site because it's deeply
// tied to draft-list state. This hook owns the confirm dialog: which
// ids are pending confirm, the daily-limit lookup result, and the
// cap-and-fire math when the user clicks Send.
//
// The single-draft path is handled outside this hook (via
// usePendingSendQueue's 5s-undo) — by the time we open this dialog we
// already know the user is sending more than one.

interface UseBatchSendConfirmOptions {
  // Fires after the user confirms and the ids have been capped to the
  // remaining daily allowance. The hook closes the modal before
  // calling onConfirm so the modal doesn't flash if onConfirm renders
  // a progress UI.
  onConfirm: (cappedIds: string[]) => void
}

interface DailyInfo {
  sentToday: number
  dailyMax: number
}

export function useBatchSendConfirm({ onConfirm }: UseBatchSendConfirmOptions) {
  const [pendingIds, setPendingIds] = useState<string[] | null>(null)
  const [dailyInfo, setDailyInfo] = useState<DailyInfo | null>(null)

  // Open the confirm + start the daily-limit fetch in parallel. dailyMax
  // is the workspace's configured cap — passed in because it lives in
  // workspaceConfig (not refetched here).
  const openFor = (ids: string[], dailyMax: number) => {
    setPendingIds(ids)
    setDailyInfo(null)
    fetchSentTodayCount()
      .then(({ count }) => setDailyInfo({ sentToday: count, dailyMax }))
      .catch(() => {})
  }

  const close = () => {
    setPendingIds(null)
    setDailyInfo(null)
  }

  // User clicked the Send button on the confirm dialog. Caps ids by
  // the remaining daily allowance and hands them to onConfirm — or
  // returns false if the user has already hit the cap (caller surfaces
  // the "limit reached" toast).
  const confirm = (): boolean => {
    if (!pendingIds || !dailyInfo) return false
    const remaining = dailyInfo.dailyMax - dailyInfo.sentToday
    const capped = pendingIds.slice(0, Math.max(0, remaining))
    setPendingIds(null)
    setDailyInfo(null)
    if (capped.length === 0) return false
    onConfirm(capped)
    return true
  }

  // Derived: remaining sends in today's window. Null when the limit
  // lookup is still pending.
  const remaining = dailyInfo ? dailyInfo.dailyMax - dailyInfo.sentToday : null

  return {
    pendingIds,
    dailyInfo,
    isOpen: pendingIds !== null,
    confirmDisabled: !dailyInfo,
    remaining,
    openFor,
    close,
    confirm,
  }
}
