import React, { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import {
  Send, X, RefreshCw, ChevronDown, ChevronUp, Pencil, Check, CheckCircle2,
  AlertCircle, FileText, ChevronLeft, ChevronRight, UserRound, Building2, Mail,
  Maximize2, Minimize2, Keyboard, Trash2, MoreHorizontal, Paperclip, MailCheck,
  Loader2, MessageSquare, Eye, XCircle,
} from 'lucide-react'
import { fetchEmails, fetchSentTodayCount, updateEmail, sendEmail, sendTestEmail, deleteEmails, updateEmailAttachments } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../hooks/useToast'
import { getAttachmentLibrary, sanitizeAttachmentIds } from '../../lib/attachments'
import {
  canSendDraft,
  draftReadiness,
  filterDrafts,
  getCompanyName,
  getRecipient,
  getRecipientName,
  htmlToEditableText,
  nextReviewDraft,
  sortDrafts,
  stripDraftHtml,
  textToDraftHtml,
} from '../../lib/draftQueue'
import { DRAFT_QUEUE_LIMIT, useDraftQueue } from '../../hooks/useCampaignWorkspaceData'
import { writeDraftQueueCache } from '../../lib/workspaceCache'
import { actionKey, runExclusive } from '../../lib/pendingActions'
import Badge from '../ui/Badge'
import Banner from '../ui/Banner'
import ConfirmDialog from '../ui/ConfirmDialog'
import EmptyState from '../ui/EmptyState'
import Modal from '../ui/Modal'
import Pill from '../ui/Pill'
import Toast from '../ui/Toast'

function formatDate(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function readinessIcon(label) {
  if (label === 'Ready') return CheckCircle2
  if (label === 'Needs recipient') return AlertCircle
  return Pencil
}

export default function DraftsTab({
  onNavigate,
  onRefreshProfile,
  workspaceConfig,
  profile = null,
  profileLoading = true,
  campaignId = null,
  lockedTab = null,
}: {
  onNavigate?: ((tab: string) => void) | null
  onRefreshProfile?: (() => void | Promise<unknown>) | null
  workspaceConfig?: any
  profile?: any
  profileLoading?: boolean
  campaignId?: string | null
  lockedTab?: 'draft' | 'sent' | null
}) {
  const [tab, setTab] = useState<'draft' | 'sent'>(lockedTab ?? 'draft')
  // When lockedTab is set (workspace sub-tab usage), the segmented Drafts/Sent
  // control is hidden and tab is forced. Each sub-tab owns its own URL.
  useEffect(() => {
    if (lockedTab && lockedTab !== tab) setTab(lockedTab)
  }, [lockedTab, tab])
  const [reviewFilter, setReviewFilter] = useState('all')
  const [sentFilter, setSentFilter] = useState('all')
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState(null)
  const [sending, setSending] = useState(false)
  const { toast, setToast } = useToast()
  const attachmentLibrary = useMemo(() => getAttachmentLibrary(workspaceConfig), [workspaceConfig])
  const [gmailStatus, setGmailStatus] = useState(() =>
    profileLoading ? 'loading' : profile?.hasGoogleRefreshToken ? 'connected' : 'disconnected'
  )
  const [sortKey, setSortKey] = useState('createdAt')
  const [sortDir, setSortDir] = useState('desc')

  // Edit state
  const [editing, setEditing] = useState(false)
  const [subjectValue, setSubjectValue] = useState('')
  const [editBody, setEditBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [focusMode, setFocusMode] = useState(false)

  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string[] | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [batchSendConfirm, setBatchSendConfirm] = useState<string[] | null>(null)
  const [batchDailyInfo, setBatchDailyInfo] = useState<{ sentToday: number; dailyMax: number } | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const { user } = useAuth()
  const draftQueue = useDraftQueue(user?.id, campaignId, tab)
  const [testSendOpen, setTestSendOpen] = useState<string | null>(null)
  const [testSendRecipient, setTestSendRecipient] = useState('')
  const [testSendBusy, setTestSendBusy] = useState(false)
  const pendingSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelBatchRef = useRef(false)

  // Refs that mirror state - read by async callbacks (the 5s setTimeout in
  // scheduleSend, the per-send loop in markSent) so they always see the
  // latest values instead of the snapshot captured when the action started.
  // Fixes bug 04: a draft edited or deleted during the undo window would
  // otherwise be sent with stale subject/body.
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const previewRef = useRef(preview)
  previewRef.current = preview

  useEffect(() => {
    if (profileLoading) return
    setGmailStatus(profile?.hasGoogleRefreshToken ? 'connected' : 'disconnected')
  }, [profile, profileLoading])

  useEffect(() => {
    if (!onRefreshProfile) return
    let lastRefresh = 0
    const refreshIfStale = () => {
      if (Date.now() - lastRefresh < 60_000) return
      lastRefresh = Date.now()
      onRefreshProfile()
    }
    refreshIfStale()
    const refreshOnFocus = () => refreshIfStale()
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
  }, [onRefreshProfile])

  useEffect(() => {
    setSelected(new Set())
  }, [tab, campaignId])

  useEffect(() => {
    const items = draftQueue.data?.items ?? []
    setError(draftQueue.error?.message || null)
    setNextCursor(draftQueue.data?.nextCursor ?? null)
    setLoading(draftQueue.isLoading || (draftQueue.isValidating && items.length === 0))
    setDrafts(items)
    setPreview(current => current && items.some(draft => draft.id === current.id) ? current : null)
  }, [draftQueue.data, draftQueue.error, draftQueue.isLoading, draftQueue.isValidating])

  useEffect(() => {
    if (!loading) writeDraftQueueCache(user?.id, tab, drafts, campaignId)
  }, [drafts, loading, tab, campaignId, user?.id])

  const load = () => draftQueue.mutate()

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const params: Record<string, unknown> = { status: tab, limit: String(DRAFT_QUEUE_LIMIT), cursor: nextCursor }
      if (campaignId) params.campaignId = campaignId
      const res = await fetchEmails(params)
      const incoming = res?.items || []
      const seen = new Set(drafts.map(d => d.id))
      const merged = [...drafts, ...incoming.filter(d => !seen.has(d.id))]
      setDrafts(merged)
      setNextCursor(res?.nextCursor ?? null)
      writeDraftQueueCache(user?.id, tab, merged, campaignId)
      draftQueue.mutate({ items: merged, nextCursor: res?.nextCursor ?? null }, { revalidate: false })
    } catch (err: any) {
      setError(err?.message || 'Could not load more emails.')
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    if (!preview) {
      if (focusMode) setFocusMode(false)
      return
    }
    return undefined
  }, [preview, focusMode])

  useEffect(() => {
    setSubjectValue(preview?.subject || '')
  }, [preview?.id])

  const openPreview = (draft) => {
    setPreview(draft)
    setEditing(false)
    setSaveError(null)
  }

  const startEdit = () => {
    setSubjectValue(preview.subject || '')
    setEditBody(htmlToEditableText(preview.body))
    setEditing(true)
    setSaveError(null)
  }

  const cancelEdit = () => {
    setSubjectValue(preview?.subject || '')
    setEditBody(htmlToEditableText(preview?.body))
    setEditing(false)
    setSaveError(null)
  }

  const saveEdit = async () => {
    setSaving(true)
    setSaveError(null)
    const originalDrafts = drafts
    const originalPreview = preview
    const optimisticDrafts = drafts.map(d => d.id === preview.id ? { ...d, subject: subjectValue, body: editBody } : d)
    setDrafts(optimisticDrafts)
    setPreview({ ...preview, subject: subjectValue, body: editBody })
    draftQueue.mutate({ items: optimisticDrafts, nextCursor }, { revalidate: false })
    try {
      const updated = await runExclusive(actionKey('draft-edit', preview.id), () => updateEmail({ id: preview.id, subject: subjectValue, body: editBody }))
      const merged = { ...preview, subject: updated.subject ?? subjectValue, body: updated.body ?? editBody }
      setDrafts(prev => prev.map(d => d.id === preview.id ? { ...d, subject: merged.subject, body: merged.body } : d))
      setPreview(merged)
      setEditing(false)
      void draftQueue.mutate()
    } catch (err) {
      setDrafts(originalDrafts)
      setPreview(originalPreview)
      draftQueue.mutate({ items: originalDrafts, nextCursor }, { revalidate: false })
      setSaveError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const draftCounts = useMemo(() => {
    const counts = { all: drafts.length, ready: 0, needsReview: 0, needsRecipient: 0 }
    drafts.forEach(draft => {
      const status = draftReadiness(draft).label
      if (status === 'Ready') counts.ready += 1
      else counts.needsReview += 1
      if (status === 'Needs recipient') counts.needsRecipient += 1
    })
    return counts
  }, [drafts])

  const sortedAll = useMemo(
    () => sortDrafts(drafts, { key: sortKey, direction: sortDir, tab }),
    [drafts, sortDir, sortKey, tab],
  )

  const sorted = useMemo(() => {
    if (tab === 'draft') return filterDrafts(sortedAll, reviewFilter)
    if (tab === 'sent') {
      if (sentFilter === 'replied') return sortedAll.filter(d => d.repliedAt)
      if (sentFilter === 'no-reply') return sortedAll.filter(d => !d.repliedAt)
    }
    return sortedAll
  }, [reviewFilter, sentFilter, sortedAll, tab])

  const previewIndex = preview ? sorted.findIndex(draft => draft.id === preview.id) : -1
  const hasPreviousDraft = previewIndex > 0
  const hasNextDraft = previewIndex >= 0 && previewIndex < sorted.length - 1

  const movePreview = (direction) => {
    if (previewIndex < 0) return
    const next = sorted[previewIndex + direction]
    if (next) openPreview(next)
  }

  useEffect(() => {
    if (!preview) return
    const handler = (e) => {
      const tag = e.target.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable

      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !editing && tab === 'draft') {
        if (canSendDraft(preview) && !sending) {
          e.preventDefault()
          initiateSend([preview.id])
        }
        return
      }

      if (isInput) return

      if (e.key === 'Escape') {
        e.preventDefault()
        if (editing) cancelEdit()
        else if (focusMode) setFocusMode(false)
        else setPreview(null)
        return
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (editing) return

      switch (e.key) {
        case 'j':
        case 'ArrowRight':
          e.preventDefault()
          movePreview(1)
          break
        case 'k':
        case 'ArrowLeft':
          e.preventDefault()
          movePreview(-1)
          break
        case 'e':
          if (tab !== 'draft') return
          e.preventDefault()
          startEdit()
          break
        case 'f':
          e.preventDefault()
          setFocusMode(m => !m)
          break
        case 'x':
          e.preventDefault()
          toggleOne(preview.id)
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [preview, editing, focusMode, tab, sending, sorted, previewIndex])

  const findNextReviewDraft = (sentIds) => {
    return nextReviewDraft(sorted, preview?.id ?? null, sentIds)
  }

  const allSelected = sorted.length > 0 && sorted.every(d => selected.has(d.id))
  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(sorted.map(d => d.id)))
  }
  const toggleOne = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const gmailDisconnected = gmailStatus === 'disconnected'

  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

  const markSent = async (ids: string[]) => {
    // Read drafts via ref - the caller may have queued this through a 5s
    // setTimeout, during which the user could have edited or deleted drafts.
    const currentDrafts = draftsRef.current
    const sendableIds = ids.filter(id => {
      const draft = currentDrafts.find(d => d.id === id)
      return draft && canSendDraft(draft)
    })
    const skippedCount = ids.length - sendableIds.length

    if (sendableIds.length === 0) {
      setToast({ type: 'info', title: 'Review needed before sending', message: 'Add a recipient, subject, and body first.' })
      return
    }

    if (gmailDisconnected) {
      setToast({
        type: 'error',
        title: 'Gmail not connected',
        message: 'Connect Gmail in Settings first.',
        action: onNavigate ? { label: 'Open Settings', onClick: () => { onNavigate('settings'); setToast(null) } } : null,
      })
      return
    }

    if (skippedCount > 0) {
      setToast({ type: 'info', title: `${skippedCount} draft${skippedCount !== 1 ? 's' : ''} skipped`, message: 'Only drafts marked Ready were sent.' })
    }

    const delayMs = Math.max(15, workspaceConfig?.sendingLimits?.delaySeconds ?? 15) * 1000
    cancelBatchRef.current = false
    setSending(true)
    if (sendableIds.length > 1) setBatchProgress({ current: 0, total: sendableIds.length })

    const succeeded: string[] = []
    const failures: Array<{ name: string; reason: string }> = []
    let hitDailyLimit = false

    for (let i = 0; i < sendableIds.length; i++) {
      if (cancelBatchRef.current) break

      const id = sendableIds[i]
      if (sendableIds.length > 1) setBatchProgress({ current: i + 1, total: sendableIds.length })

      try {
        await runExclusive(actionKey('send-email', id), () => sendEmail(id))
        succeeded.push(id)
        setDrafts(prev => prev.filter(d => d.id !== id))
        setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
      } catch (err: any) {
        if (err?.status === 429) { hitDailyLimit = true; break }
        const draft = draftsRef.current.find(d => d.id === id)
        failures.push({
          name: getRecipientName(draft) || getCompanyName(draft) || 'Unknown',
          reason: err?.message || 'Send failed',
        })
      }

      if (i < sendableIds.length - 1 && !cancelBatchRef.current) {
        await sleep(delayMs)
      }
    }

    setSending(false)
    setBatchProgress(null)

    // Fix: only treat as cancelled if it actually prevented remaining sends
    const wasCancelled = cancelBatchRef.current && succeeded.length < sendableIds.length

    const currentPreview = previewRef.current
    if (currentPreview && succeeded.includes(currentPreview.id)) {
      setPreview(findNextReviewDraft(succeeded))
      setEditing(false)
    }

    if (failures.length > 0) {
      const names = failures.slice(0, 2).map(f => f.name).join(', ')
      const overflow = failures.length > 2 ? ` and ${failures.length - 2} more` : ''
      setToast({ type: 'error', title: `${failures.length} email${failures.length !== 1 ? 's' : ''} failed to send`, message: `${names}${overflow}: ${failures[0].reason}` })
    } else if (wasCancelled) {
      setToast({ type: 'info', title: succeeded.length > 0 ? `Sent ${succeeded.length} of ${sendableIds.length} - cancelled` : 'Cancelled - no emails sent', message: '' })
    } else if (hitDailyLimit) {
      setToast({ type: 'error', title: `Daily limit reached - ${succeeded.length} of ${sendableIds.length} sent`, message: 'Remaining emails were not sent. Limit resets tomorrow.' })
    } else if (succeeded.length > 0) {
      const previewWasSent = currentPreview?.id ? succeeded.includes(currentPreview.id) : false
      const nextReviewDraft = previewWasSent ? findNextReviewDraft(succeeded) : null
      setToast({
        type: 'success',
        title: succeeded.length === 1 ? 'Email sent' : `${succeeded.length} emails sent`,
        message: nextReviewDraft ? 'The next ready draft is open.' : 'Moved to Sent.',
        action: { label: 'View sent', onClick: () => { setTab('sent'); setToast(null) } },
      })
    }
  }

  useEffect(() => () => {
    if (pendingSendTimerRef.current) clearTimeout(pendingSendTimerRef.current)
  }, [])

  const cancelPendingSend = () => {
    if (pendingSendTimerRef.current) {
      clearTimeout(pendingSendTimerRef.current)
      pendingSendTimerRef.current = null
    }
    setToast(null)
  }

  const scheduleSend = (ids: string[]) => {
    cancelPendingSend()
    const targetDraft = ids.length === 1 ? draftsRef.current.find(d => d.id === ids[0]) : null
    const label = targetDraft ? getRecipientName(targetDraft) : null
    setToast({
      type: 'info',
      title: label ? `Sending to ${label} in 5 seconds…` : `Sending ${ids.length} emails in 5 seconds…`,
      message: '',
      duration: 5500,
      action: { label: 'Undo', onClick: cancelPendingSend },
    })
    pendingSendTimerRef.current = setTimeout(() => {
      pendingSendTimerRef.current = null
      setToast(null)
      // Re-derive against current drafts at fire time - markSent already uses
      // the ref, but filtering ids here drops any that were deleted during
      // the undo window so we don't even attempt the network call.
      const liveIds = ids.filter(id => draftsRef.current.some(d => d.id === id))
      if (liveIds.length === 0) return
      markSent(liveIds)
    }, 5000)
  }

  const initiateSend = (ids: string[]) => {
    if (ids.length > 1) {
      setBatchSendConfirm(ids)
      setBatchDailyInfo(null)
      const dailyMax = workspaceConfig?.sendingLimits?.dailyMax ?? 100
      fetchSentTodayCount()
        .then(({ count }) => setBatchDailyInfo({ sentToday: count, dailyMax }))
        .catch(() => {})
    } else {
      scheduleSend(ids)
    }
  }

  const openTestSend = (emailId: string) => {
    setTestSendRecipient(user?.email || '')
    setTestSendOpen(emailId)
  }

  const submitTestSend = async () => {
    if (!testSendOpen) return
    setTestSendBusy(true)
    try {
      await runExclusive(
        actionKey('test-send-email', testSendOpen, testSendRecipient.trim().toLowerCase()),
        () => sendTestEmail(testSendOpen, testSendRecipient),
      )
      setToast({
        type: 'success',
        title: 'Test email sent',
        message: `Delivered to ${testSendRecipient.trim().toLowerCase()}`,
      })
      setTestSendOpen(null)
    } catch (err) {
      setToast({
        type: 'error',
        title: 'Test send failed',
        message: (err as Error)?.message || 'Try again.',
      })
    } finally {
      setTestSendBusy(false)
    }
  }

  const deleteDrafts = async (ids: string[]) => {
    setDeleting(true)
    const originalDrafts = drafts
    const originalPreview = preview
    const remaining = drafts.filter(d => !ids.includes(d.id))
    setDrafts(remaining)
    setSelected(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next })
    if (preview && ids.includes(preview.id)) {
      const nextDraft = sorted.find(d => !ids.includes(d.id) && d.id !== preview.id)
      setPreview(nextDraft || null)
      setEditing(false)
    }
    draftQueue.mutate({ items: remaining, nextCursor }, { revalidate: false })
    try {
      await runExclusive(actionKey('draft-delete', ids.join(',')), () => deleteEmails(ids))
      void draftQueue.mutate()
      setToast({
        type: 'success',
        title: ids.length === 1 ? 'Draft deleted' : `${ids.length} drafts deleted`,
        message: '',
      })
    } catch (err: any) {
      setDrafts(originalDrafts)
      setPreview(originalPreview)
      draftQueue.mutate({ items: originalDrafts, nextCursor }, { revalidate: false })
      setToast({ type: 'error', title: 'Could not delete', message: err?.message || 'Please try again.' })
    } finally {
      setDeleting(false)
      setDeleteConfirm(null)
    }
  }

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <ChevronDown size={11} className="text-muted/40" />
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="text-muted" />
      : <ChevronDown size={11} className="text-muted" />
  }

  const selectedArr = [...selected]
  const readyCount = draftCounts.ready
  const needsWorkCount = draftCounts.needsReview
  const filterOptions = [
    { id: 'all', label: 'All', count: draftCounts.all },
    { id: 'ready', label: 'Ready', count: draftCounts.ready },
    { id: 'needsReview', label: 'Needs review', count: draftCounts.needsReview },
    { id: 'needsRecipient', label: 'Missing recipient', count: draftCounts.needsRecipient },
  ]

  return (
    <div className="surface-panel flex min-h-[560px] flex-col overflow-hidden lg:flex-row">
      <Toast toast={toast} onClose={() => setToast(null)} />
      {/* Main list */}
      <div className={`flex min-w-0 flex-1 flex-col p-4 sm:p-5 lg:p-6 ${preview ? 'lg:pr-4' : ''} ${focusMode ? 'hidden' : ''}`}>
        <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            {!lockedTab && (
              <div className="segmented-control">
                <button onClick={() => setTab('draft')} className={`segmented-chip ${tab === 'draft' ? 'segmented-chip-active' : ''}`}>Drafts</button>
                <button onClick={() => setTab('sent')} className={`segmented-chip ${tab === 'sent' ? 'segmented-chip-active' : ''}`}>Sent</button>
              </div>
            )}
            <p className="text-sm text-muted">
              {loading
                ? drafts.length > 0 ? 'Refreshing...' : 'Loading...'
                : `${drafts.length} ${tab === 'sent' ? 'sent' : 'draft'}${drafts.length !== 1 ? 's' : ''}`}
            </p>
            {tab === 'draft' && !loading && drafts.length > 0 && (
              <p className="text-xs text-muted">
                {readyCount} ready, {needsWorkCount} need{needsWorkCount === 1 ? 's' : ''} review
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {tab === 'draft' && sorted.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="btn-ghost text-xs text-muted hover:text-dark"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            )}
            {tab === 'draft' && selectedArr.length > 0 && (
              sending ? (
                <div className="flex items-center gap-2">
                  {batchProgress && (
                    <span className="text-xs text-muted tabular-nums">
                      Sending {batchProgress.current} of {batchProgress.total}…
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => { cancelBatchRef.current = true }}
                    className="btn-ghost text-xs text-red-500 hover:bg-red-50 py-1.5 px-3"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => initiateSend(selectedArr)}
                    disabled={deleting}
                    className="btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3"
                  >
                    <Send size={13} />
                    {`Send ${selectedArr.length}`}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(selectedArr)}
                    disabled={deleting}
                    className="btn-ghost flex items-center gap-1.5 text-sm py-1.5 px-3 text-red-500 hover:bg-red-50"
                  >
                    <Trash2 size={13} />
                    {deleting ? 'Deleting…' : `Delete ${selectedArr.length}`}
                  </button>
                </>
              )
            )}
            <button
              onClick={load}
              disabled={loading}
              className="btn-ghost p-1.5 text-muted hover:text-dark"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {error && (
          <Banner variant="danger" className="mb-4">{error}</Banner>
        )}

        {tab === 'draft' && gmailDisconnected && (
          <Banner variant="warning" icon={AlertCircle} className="mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>Gmail not connected. Connect in Settings.</span>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('settings')}
                  className="shrink-0 text-xs font-semibold text-amber-900 underline-offset-2 hover:underline"
                >
                  Open Settings
                </button>
              )}
            </div>
          </Banner>
        )}

        {tab === 'draft' && drafts.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {filterOptions.map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => setReviewFilter(option.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  reviewFilter === option.id
                    ? 'bg-primary text-warm-50'
                    : 'bg-warm-50 text-muted border border-warm-200 hover:bg-warm-50 hover:text-dark'
                }`}
              >
                {option.label} <span className={reviewFilter === option.id ? 'text-warm-50/75' : 'text-muted/70'}>{option.count}</span>
              </button>
            ))}
          </div>
        )}
        {tab === 'sent' && drafts.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {[
              { id: 'all', label: 'All' },
              { id: 'replied', label: 'Replied' },
              { id: 'no-reply', label: 'No reply' },
            ].map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSentFilter(option.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  sentFilter === option.id
                    ? 'bg-primary text-warm-50'
                    : 'bg-warm-50 text-muted border border-warm-200 hover:bg-warm-50 hover:text-dark'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        <div className="table-shell">
          <table className="min-w-[760px] w-full text-sm">
            <thead>
              <tr className="border-b border-warm-200">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-warm-300"
                    aria-label={tab === 'draft' ? 'Select all drafts' : 'Select all sent emails'}
                  />
                </th>
                {[
                  ['name', 'Contact'],
                  ['company', 'Company'],
                  ['subject', 'Subject'],
                  ['createdAt', 'Date'],
                ].map(([key, label]) => (
                  <th key={key} className="px-4 py-3 text-left">
                    <button
                      onClick={() => toggleSort(key)}
                      className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80 hover:text-dark transition-colors"
                    >
                      {label} <SortIcon col={key} />
                    </button>
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-200">
              {loading && drafts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted">Loading drafts…</td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={FileText}
                      title={
                        tab === 'sent'
                          ? campaignId ? 'Nothing sent from this campaign yet' : 'No sent emails yet'
                          : reviewFilter === 'all'
                            ? 'No drafts ready for review'
                            : 'No drafts in this queue'
                      }
                      description={
                        tab === 'sent'
                          ? campaignId
                            ? 'Sent emails from this campaign will appear here once Gmail accepts them.'
                            : 'Sent emails will appear here after Gmail accepts them.'
                          : reviewFilter === 'all'
                            ? 'Generate an email from a saved contact, then review and send it here.'
                            : 'Switch or clear filters to see more.'
                      }
                      action={
                        onNavigate && (
                          <button type="button" onClick={() => onNavigate(tab === 'sent' ? 'drafts' : 'contacts')} className="btn-primary text-xs">
                            {tab === 'sent' ? 'Go to Drafts' : 'Go to Contacts'}
                          </button>
                        )
                      }
                    />
                  </td>
                </tr>
              ) : sorted.map(draft => (
                <tr
                  key={draft.id}
                  onClick={() => openPreview(draft)}
                  className={`cursor-pointer transition-colors hover:bg-warm-50 ${preview?.id === draft.id ? 'bg-warm-50' : ''}`}
                >
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(draft.id)}
                      onChange={() => toggleOne(draft.id)}
                      className="rounded border-warm-300"
                      aria-label={`Select ${tab === 'draft' ? 'draft' : 'sent email'} for ${getRecipientName(draft)}`}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-dark">
                    {getRecipientName(draft)}
                    {(draft.contact?.title || draft.customContact?.title) && (
                      <div className="text-xs text-muted font-normal">{draft.contact?.title || draft.customContact?.title}</div>
                    )}
                    {getRecipient(draft) && (
                      <div className="text-xs text-primary/80 font-normal">{getRecipient(draft)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{getCompanyName(draft) || '-'}</td>
                  <td className="px-4 py-3 text-dark max-w-xs">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{draft.subject || '(no subject)'}</span>
                      {sanitizeAttachmentIds(draft.attachmentIds).length > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warm-100 px-2 py-0.5 text-[11px] font-medium text-muted">
                          <Paperclip size={10} /> {sanitizeAttachmentIds(draft.attachmentIds).length}
                        </span>
                      )}
                      {tab === 'draft' && (() => {
                        const status = draftReadiness(draft)
                        return (
	                          <Pill
	                            variant={status.label === 'Ready' ? 'success' : 'warning'}
	                            icon={readinessIcon(status.label)}
                            className="shrink-0"
                          >
                            {status.label}
                          </Pill>
                        )
                      })()}
                    </div>
                    <div className="truncate text-xs text-muted">{stripDraftHtml(draft.body)}</div>
                  </td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDate(tab === 'sent' ? draft.sentAt : draft.createdAt)}</td>
                  <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                    {tab === 'draft' && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => initiateSend([draft.id])}
                          disabled={sending || !canSendDraft(draft)}
                          title={canSendDraft(draft) ? 'Send email' : 'Review needed before sending'}
                          className="btn-ghost px-2 py-1 text-xs flex items-center gap-1 hover:text-primary disabled:opacity-40"
                        >
                          <Send size={11} /> Send
                        </button>
                        <button
                          onClick={() => setDeleteConfirm([draft.id])}
                          disabled={deleting}
                          title="Delete draft"
                          className="btn-ghost px-2 py-1 text-xs flex items-center gap-1 hover:text-red-500 disabled:opacity-40"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                    {tab === 'sent' && (
                      <SentStatusPill draft={draft} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {nextCursor && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="btn-secondary inline-flex items-center gap-1.5 text-xs py-1.5 px-3 disabled:opacity-50"
            >
              {loadingMore ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
              {loadingMore ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </div>

      {/* Preview / edit panel */}
      {preview && (
        <div className={`flex shrink-0 flex-col border-t border-warm-200 bg-warm-50 lg:border-t-0 ${focusMode ? 'w-full flex-1' : 'w-full lg:w-[46%] lg:min-w-[520px] lg:max-w-[720px] lg:border-l'}`}>
          {/* Panel header */}
          <div className="flex flex-col gap-3 border-b border-warm-200 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex items-center gap-2.5">
              <p className="font-medium text-dark truncate">{getRecipientName(preview)}</p>
              {tab === 'sent' ? (
                <Badge variant="sent">Sent</Badge>
              ) : (
                <Badge variant={draftReadiness(preview).label === 'Ready' ? 'ready' : 'paused'}>
                  {draftReadiness(preview).label}
                </Badge>
              )}
              {previewIndex >= 0 && sorted.length > 1 && (
                <span className="text-[11px] text-muted/70 tabular-nums shrink-0">
                  {previewIndex + 1} / {sorted.length}
                </span>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 lg:ml-3">
              {/* Navigation */}
              <div className="flex items-center rounded-full bg-warm-50 p-0.5">
                <button
                  type="button"
                  onClick={() => movePreview(-1)}
                  disabled={!hasPreviousDraft}
                  className="btn-ghost p-1.5 disabled:opacity-30"
                  title="Previous draft (←)"
                >
                  <ChevronLeft size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => movePreview(1)}
                  disabled={!hasNextDraft}
                  className="btn-ghost p-1.5 disabled:opacity-30"
                  title="Next draft (→)"
                >
                  <ChevronRight size={13} />
                </button>
              </div>

              {/* Edit / Save / Cancel - sent emails are immutable, no edit affordance. */}
              {tab === 'draft' && (!editing ? (
                <button
                  onClick={startEdit}
                  className="btn-ghost flex items-center gap-1.5 text-xs py-1 px-2.5 text-muted hover:text-dark"
                >
                  <Pencil size={11} /> Edit
                </button>
              ) : (
                <>
                  <button
                    onClick={cancelEdit}
                    disabled={saving}
                    className="btn-ghost text-xs py-1 px-2.5 text-muted hover:text-dark"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveEdit}
                    disabled={saving}
                    className="btn-primary flex items-center gap-1.5 text-xs py-1 px-2.5"
                  >
                    <Check size={11} /> {saving ? 'Saving…' : 'Save'}
                  </button>
                </>
              ))}

              {/* Send */}
              {tab === 'draft' && !editing && (
                <button
                  onClick={() => initiateSend([preview.id])}
                  disabled={sending || !canSendDraft(preview)}
                  title={canSendDraft(preview) ? 'Send email (⌘↵)' : 'Review needed before sending'}
                  className="btn-primary flex items-center gap-1.5 text-xs py-1 px-2.5"
                >
                  <Send size={11} /> Send
                </button>
              )}

              {/* More: focus mode + delete */}
              <div className="relative" ref={moreMenuRef}>
                {moreMenuOpen && (
                  <div className="fixed inset-0 z-10" onClick={() => setMoreMenuOpen(false)} />
                )}
                <button
                  type="button"
                  onClick={() => setMoreMenuOpen(o => !o)}
                  className="btn-ghost p-1.5 text-muted hover:text-dark"
                  title="More options"
                >
                  <MoreHorizontal size={14} />
                </button>
                {moreMenuOpen && (
                  <div className="absolute right-0 top-full z-20 mt-1 min-w-[180px] overflow-hidden rounded-xl border border-warm-200 bg-warm-50 py-1 shadow-card">
                    <button
                      type="button"
                      onClick={() => { setFocusMode(m => !m); setMoreMenuOpen(false) }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-muted hover:bg-warm-50 hover:text-dark"
                    >
                      {focusMode ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                      {focusMode ? 'Exit focus mode' : 'Focus mode'}
                    </button>
                    {tab === 'draft' && (
                      <button
                        type="button"
                        onClick={() => { openTestSend(preview.id); setMoreMenuOpen(false) }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-muted hover:bg-warm-50 hover:text-dark"
                      >
                        <MailCheck size={13} />
                        Send test to me
                      </button>
                    )}
                    {tab === 'draft' && (
                      <button
                        type="button"
                        onClick={() => { setDeleteConfirm([preview.id]); setMoreMenuOpen(false) }}
                        disabled={deleting}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      >
                        <Trash2 size={13} /> Delete draft
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Close */}
              <button
                onClick={() => { setPreview(null); setEditing(false) }}
                className="btn-ghost p-1 text-muted hover:text-dark"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {saveError && (
            <Banner variant="danger" size="sm" className="mx-4 mt-3 sm:mx-5">{saveError}</Banner>
          )}

          {/* Panel body */}
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="rounded-2xl border border-warm-200 bg-warm-50/70 px-4 py-3">
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                <UserRound size={14} className="mt-0.5 text-muted" />
                <div className="min-w-0">
                  <p className="font-medium text-dark truncate">{getRecipientName(preview)}</p>
                  {(preview.contact?.title || preview.customContact?.title) && (
                    <p className="mt-0.5 text-muted truncate">{preview.contact?.title || preview.customContact?.title}</p>
                  )}
                </div>
                <Mail size={14} className="mt-0.5 text-muted" />
                <p className={`min-w-0 truncate ${getRecipient(preview) ? 'text-primary' : 'text-amber-700'}`}>
                  {getRecipient(preview) || 'Recipient email missing'}
                </p>
                <Building2 size={14} className="mt-0.5 text-muted" />
                <p className="min-w-0 truncate text-muted">{getCompanyName(preview) || 'No company attached'}</p>
              </div>
            </div>

            {/* Subject */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/70 mb-2">Subject</p>
              {tab === 'draft' && editing ? (
                <input
                  type="text"
                  aria-label="Draft subject"
                  value={subjectValue}
                  onChange={e => setSubjectValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      saveEdit()
                    }
                  }}
                  className="input w-full text-sm font-semibold"
                  placeholder="Subject line"
                />
              ) : (
                <p className="text-base font-semibold leading-6 text-dark">{preview.subject || '(no subject)'}</p>
              )}
            </div>

            {/* Body */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/70 mb-2">Body</p>
              {editing ? (
                <textarea
                  aria-label="Draft body"
                  value={editBody}
                  onChange={e => setEditBody(e.target.value)}
                  rows={16}
                  className="input w-full resize-y text-sm leading-relaxed"
                  placeholder="Email body…"
                />
              ) : (
                <div
                  className="max-w-[68ch] rounded-2xl border border-warm-200 bg-warm-50 px-4 py-4 text-[15px] leading-7 text-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(textToDraftHtml(preview.body)) }}
                />
              )}
            </div>

            {/* Attachments */}
            {tab === 'draft' && !editing && (() => {
              const attachedIds = sanitizeAttachmentIds(preview.attachmentIds)

              const toggleAttachment = async (fileId: string, add: boolean) => {
                const next = add ? [...attachedIds, fileId] : attachedIds.filter(id => id !== fileId)
                setPreview(p => p ? { ...p, attachmentIds: next } : p)
                setDrafts(prev => prev.map(d => d.id === preview.id ? { ...d, attachmentIds: next } : d))
                try { await updateEmailAttachments(preview.id, next) } catch {
                  setPreview(p => p ? { ...p, attachmentIds: attachedIds } : p)
                  setDrafts(prev => prev.map(d => d.id === preview.id ? { ...d, attachmentIds: attachedIds } : d))
                }
              }

              return (
                <div className="border-t border-warm-200 pt-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/70">Attachments</p>
                    {attachedIds.length > 0 && <span className="text-xs text-muted">{attachedIds.length} selected</span>}
                  </div>
                  {attachmentLibrary.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-warm-200 bg-warm-50 px-3 py-2 text-xs text-muted">Upload a resume or file in Settings to attach it.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {attachmentLibrary.map(f => {
                        const checked = attachedIds.includes(f.id)
                        return (
                          <label key={f.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-warm-200 bg-panel px-3 py-2 transition-colors hover:border-primary/20 hover:bg-primary/5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleAttachment(f.id, !checked)}
                              className="rounded border-warm-300"
                            />
                            {f.source === 'resume' ? <FileText size={13} className="shrink-0 text-primary" /> : <Paperclip size={13} className="shrink-0 text-muted" />}
                            <span className="min-w-0 flex-1 truncate text-xs font-medium text-dark">{f.fileName}</span>
                            {f.source === 'resume' && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Resume</span>}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Meta — dates only. Status lives in the header; recipient + company
                live in the recipient card above. */}
            <div className="border-t border-warm-200 pt-4 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted">Created</span>
                <span className="text-dark">{formatDate(preview.createdAt)}</span>
              </div>
              {preview.sentAt && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted">Sent</span>
                  <span className="text-dark">{formatDate(preview.sentAt)}</span>
                </div>
              )}
              {tab === 'sent' && preview.openedAt && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted flex items-center gap-1">
                    Opened
                    <span title="Many email clients pre-fetch images — opens are an estimate" className="cursor-help text-muted/60">(?)</span>
                  </span>
                  <span className="text-dark">{formatDate(preview.openedAt)}</span>
                </div>
              )}
              {tab === 'sent' && preview.repliedAt && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted">Reply received</span>
                  <span className="text-dark">{formatDate(preview.repliedAt)}</span>
                </div>
              )}
              {tab === 'sent' && preview.repliedAt && preview.replyFrom && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted">From</span>
                  <span className="text-dark truncate max-w-[60%]">{preview.replyFrom}</span>
                </div>
              )}
            </div>
          </div>
          <ShortcutHint editing={editing} canEdit={tab === 'draft'} canSend={tab === 'draft' && canSendDraft(preview)} />
        </div>
      )}
      <ConfirmDialog
        open={!!batchSendConfirm}
        onClose={() => { setBatchSendConfirm(null); setBatchDailyInfo(null) }}
        onConfirm={() => {
          const ids = batchSendConfirm ?? []
          const remaining = batchDailyInfo.dailyMax - batchDailyInfo.sentToday
          const capped = ids.slice(0, Math.max(0, remaining))
          setBatchSendConfirm(null)
          setBatchDailyInfo(null)
          if (capped.length > 0) markSent(capped)
          else setToast({ type: 'error', title: 'Daily send limit already reached', message: 'No emails sent. Limit resets tomorrow.' })
        }}
        confirmLabel="Send"
        danger={false}
        confirmDisabled={!batchDailyInfo}
        title={`Send ${batchSendConfirm?.length} emails`}
        message={(() => {
          const base = `Emails will be sent one at a time with a ${workspaceConfig?.sendingLimits?.delaySeconds ?? 15}s delay between each.`
          if (!batchDailyInfo) return `${base} Checking daily limit…`
          const remaining = batchDailyInfo.dailyMax - batchDailyInfo.sentToday
          if (remaining <= 0) return `You've reached your daily send limit (${batchDailyInfo.dailyMax}/day). No emails will be sent.`
          if (remaining < (batchSendConfirm?.length ?? 0)) return `${base} You have ${remaining} send${remaining !== 1 ? 's' : ''} left today (limit: ${batchDailyInfo.dailyMax}/day) - only ${remaining} of ${batchSendConfirm?.length} will be sent.`
          return `${base} You have ${remaining} send${remaining !== 1 ? 's' : ''} left today (limit: ${batchDailyInfo.dailyMax}/day).`
        })()}
      />
      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && deleteDrafts(deleteConfirm)}
        title={deleteConfirm?.length === 1 ? 'Delete draft' : `Delete ${deleteConfirm?.length} drafts`}
        message={
          deleteConfirm?.length === 1
            ? 'This draft will be permanently deleted.'
            : `These ${deleteConfirm?.length} drafts will be permanently deleted.`
        }
      />
      <Modal
        open={!!testSendOpen}
        onClose={() => { if (!testSendBusy) setTestSendOpen(null) }}
        title="Send test email"
        size="sm"
      >
        <form
          className="px-5 py-5"
          onSubmit={e => { e.preventDefault(); submitTestSend() }}
        >
          <p className="text-sm text-muted">
            Sends this draft to the address below with <span className="font-medium text-dark">[TEST]</span> on the subject. The original draft stays a draft.
          </p>
          <label className="mt-4 block text-xs font-medium text-muted" htmlFor="test-send-recipient">
            Recipient
          </label>
          <input
            id="test-send-recipient"
            type="email"
            autoFocus
            required
            value={testSendRecipient}
            onChange={e => setTestSendRecipient(e.target.value)}
            disabled={testSendBusy}
            className="mt-1 w-full rounded-md border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-dark focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setTestSendOpen(null)}
              disabled={testSendBusy}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={testSendBusy || !testSendRecipient.trim()}
              className="btn-primary disabled:opacity-50"
            >
              {testSendBusy ? 'Sending…' : 'Send test'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function ShortcutHint({ editing, canEdit, canSend }) {
  if (editing) {
    return (
      <div className="hidden border-t border-warm-200 px-5 py-2 text-[11px] text-muted/80 sm:flex sm:items-center sm:gap-3">
        <Keyboard size={11} />
        <Kbd>esc</Kbd> cancel
        <Kbd>⌘</Kbd>+<Kbd>↵</Kbd> save (after exit)
      </div>
    )
  }
  return (
    <div className="hidden border-t border-warm-200 px-5 py-2 text-[11px] text-muted/80 sm:flex sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1">
      <Keyboard size={11} />
      <span><Kbd>←</Kbd> <Kbd>→</Kbd> prev/next</span>
      {canEdit && <span><Kbd>e</Kbd> edit</span>}
      {canSend && <span><Kbd>⌘</Kbd>+<Kbd>↵</Kbd> send</span>}
      <span><Kbd>x</Kbd> select</span>
      <span><Kbd>f</Kbd> focus</span>
      <span><Kbd>esc</Kbd> close</span>
    </div>
  )
}

function Kbd({ children }) {
  return <kbd className="rounded border border-warm-300 bg-warm-50 px-1 text-[10px] font-medium text-muted">{children}</kbd>
}

function SentStatusPill({ draft }: { draft: any }) {
  if (draft.replyClassification === 'BOUNCE') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
        <XCircle size={11} /> Bounced
      </span>
    )
  }
  if (draft.repliedAt) {
    const label = draft.replyClassification === 'AUTO_REPLY' ? 'Auto-reply' : 'Replied'
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
        <MessageSquare size={11} /> {label}
      </span>
    )
  }
  if (draft.openedAt) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 cursor-help"
        title="Many email clients pre-fetch images — opens are an estimate"
      >
        <Eye size={11} /> Opened
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
      <CheckCircle2 size={12} /> Sent
    </span>
  )
}
