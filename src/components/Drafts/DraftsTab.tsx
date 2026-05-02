import React, { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import {
  Send, X, RefreshCw, ChevronDown, ChevronUp, Pencil, Check, CheckCircle2,
  AlertCircle, FileText, ChevronLeft, ChevronRight, UserRound, Building2, Mail,
  Maximize2, Minimize2, Keyboard, Trash2, MoreHorizontal, Paperclip,
} from 'lucide-react'
import { apiGetAuth, fetchEmails, fetchSentTodayCount, updateEmail, sendEmail, deleteEmails, updateEmailAttachments } from '../../lib/api'
import Badge from '../ui/Badge'
import Banner from '../ui/Banner'
import ConfirmDialog from '../ui/ConfirmDialog'
import EmptyState from '../ui/EmptyState'
import Pill from '../ui/Pill'
import Toast from '../ui/Toast'

// For table row previews — collapse to one line
function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Plain text → HTML for display (preserves paragraph and line-break structure)
function textToHtml(text) {
  if (!text) return ''
  if (text.includes('<')) return text  // already HTML, render as-is
  return text
    .split(/\n{2,}/)
    .map(block => `<p style="margin:0 0 0.75em">${block.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// HTML → plain text for editing
function htmlToText(html) {
  if (!html) return ''
  if (!html.includes('<')) return html
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getRecipient(draft) {
  return draft.contact?.email || draft.customContact?.email || ''
}

function getRecipientName(draft) {
  return draft.contact?.name || draft.customContact?.name || 'Contact'
}

function getCompanyName(draft) {
  return draft.userLead?.company?.name || draft.customContact?.companyName || ''
}

function getDraftReadiness(draft) {
  if (!getRecipient(draft)) return { variant: 'failed', label: 'Needs recipient', icon: AlertCircle }
  if (!draft.subject?.trim() || !stripHtml(draft.body).trim()) return { variant: 'paused', label: 'Needs edit', icon: Pencil }
  return { variant: 'ready', label: 'Ready', icon: CheckCircle2 }
}

function canSendDraft(draft) {
  return getDraftReadiness(draft).label === 'Ready'
}

function getDraftCacheKey(tab) {
  const { userId } = apiGetAuth()
  return userId ? `cf_email_cache_${userId}_${tab}` : null
}

function readDraftCache(tab) {
  const key = getDraftCacheKey(tab)
  if (!key) return null
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

function writeDraftCache(tab, items) {
  const key = getDraftCacheKey(tab)
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify({ cachedAt: new Date().toISOString(), items }))
  } catch {
    // Cache writes should never block draft actions.
  }
}

export default function DraftsTab({ onNavigate, workspaceConfig, profile = null, profileLoading = true }) {
  const [tab, setTab] = useState('draft')
  const [reviewFilter, setReviewFilter] = useState('all')
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [preview, setPreview] = useState(null)
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState(null)
  const [gmailStatus, setGmailStatus] = useState(() =>
    profileLoading ? 'loading' : profile?.hasGoogleRefreshToken ? 'connected' : 'disconnected'
  )
  const [sortKey, setSortKey] = useState('createdAt')
  const [sortDir, setSortDir] = useState('desc')

  // Edit state
  const [editing, setEditing] = useState(false)
  const [editSubject, setEditSubject] = useState('')
  const [editBody, setEditBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [focusMode, setFocusMode] = useState(false)

  const [loadCount, setLoadCount] = useState(0)
  const [deleteConfirm, setDeleteConfirm] = useState<string[] | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [batchSendConfirm, setBatchSendConfirm] = useState<string[] | null>(null)
  const [batchDailyInfo, setBatchDailyInfo] = useState<{ sentToday: number; dailyMax: number } | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const pendingSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelBatchRef = useRef(false)

  useEffect(() => {
    if (profileLoading) return
    setGmailStatus(profile?.hasGoogleRefreshToken ? 'connected' : 'disconnected')
  }, [profile, profileLoading])

  useEffect(() => {
    let cancelled = false
    const cached = readDraftCache(tab)
    setError(null)
    setSelected(new Set())
    if (cached?.items) {
      setDrafts(cached.items)
      setLoading(false)
      setPreview(current => current && cached.items.some(draft => draft.id === current.id) ? current : null)
    } else {
      setDrafts([])
      setPreview(null)
      setLoading(true)
    }
    fetchEmails({ status: tab, limit: '200' })
      .then(res => {
        if (cancelled) return
        const items = res?.items || []
        setDrafts(items)
        writeDraftCache(tab, items)
      })
      .catch(err => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [loadCount, tab])

  useEffect(() => {
    if (!loading) writeDraftCache(tab, drafts)
  }, [drafts, loading, tab])

  const load = () => setLoadCount(c => c + 1)

  useEffect(() => {
    if (!preview) {
      if (focusMode) setFocusMode(false)
      return
    }
    return undefined
  }, [preview, focusMode])

  const openPreview = (draft) => {
    setPreview(draft)
    setEditing(false)
    setSaveError(null)
  }

  const startEdit = () => {
    setEditSubject(preview.subject || '')
    setEditBody(htmlToText(preview.body))
    setEditing(true)
    setSaveError(null)
  }

  const cancelEdit = () => {
    setEditing(false)
    setSaveError(null)
  }

  const saveEdit = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateEmail({ id: preview.id, subject: editSubject, body: editBody })
      const merged = { ...preview, subject: updated.subject ?? editSubject, body: updated.body ?? editBody }
      setDrafts(prev => prev.map(d => d.id === preview.id ? { ...d, subject: merged.subject, body: merged.body } : d))
      setPreview(merged)
      setEditing(false)
    } catch (err) {
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
      const status = getDraftReadiness(draft).label
      if (status === 'Ready') counts.ready += 1
      else counts.needsReview += 1
      if (status === 'Needs recipient') counts.needsRecipient += 1
    })
    return counts
  }, [drafts])

  const sortedAll = useMemo(() => [...drafts].sort((a, b) => {
    let av, bv
    if (sortKey === 'name') {
      av = getRecipientName(a)
      bv = getRecipientName(b)
    } else if (sortKey === 'company') {
      av = getCompanyName(a)
      bv = getCompanyName(b)
    } else if (sortKey === 'subject') {
      av = a.subject || ''
      bv = b.subject || ''
    } else {
      av = tab === 'sent' ? (a.sentAt || '') : (a.createdAt || '')
      bv = tab === 'sent' ? (b.sentAt || '') : (b.createdAt || '')
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  }), [drafts, sortDir, sortKey, tab])

  const sorted = useMemo(() => {
    if (tab !== 'draft' || reviewFilter === 'all') return sortedAll
    return sortedAll.filter(draft => {
      const status = getDraftReadiness(draft).label
      if (reviewFilter === 'ready') return status === 'Ready'
      if (reviewFilter === 'needsReview') return status !== 'Ready'
      if (reviewFilter === 'needsRecipient') return status === 'Needs recipient'
      return true
    })
  }, [reviewFilter, sortedAll, tab])

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
    const remaining = sorted.filter(draft => !sentIds.includes(draft.id) && canSendDraft(draft))
    if (!remaining.length) return null
    if (!preview) return remaining[0]

    const currentIndex = sorted.findIndex(draft => draft.id === preview.id)
    const after = sorted
      .slice(Math.max(currentIndex + 1, 0))
      .find(draft => !sentIds.includes(draft.id) && canSendDraft(draft))
    return after || remaining[0]
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
    const sendableIds = ids.filter(id => {
      const draft = drafts.find(d => d.id === id)
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
        await sendEmail(id)
        succeeded.push(id)
        setDrafts(prev => prev.filter(d => d.id !== id))
        setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
      } catch (err: any) {
        if (err?.status === 429) { hitDailyLimit = true; break }
        const draft = drafts.find(d => d.id === id)
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

    if (preview && succeeded.includes(preview.id)) {
      setPreview(findNextReviewDraft(succeeded))
      setEditing(false)
    }

    if (failures.length > 0) {
      const names = failures.slice(0, 2).map(f => f.name).join(', ')
      const overflow = failures.length > 2 ? ` and ${failures.length - 2} more` : ''
      setToast({ type: 'error', title: `${failures.length} email${failures.length !== 1 ? 's' : ''} failed to send`, message: `${names}${overflow}: ${failures[0].reason}` })
    } else if (wasCancelled) {
      setToast({ type: 'info', title: succeeded.length > 0 ? `Sent ${succeeded.length} of ${sendableIds.length} — cancelled` : 'Cancelled — no emails sent', message: '' })
    } else if (hitDailyLimit) {
      setToast({ type: 'error', title: `Daily limit reached — ${succeeded.length} of ${sendableIds.length} sent`, message: 'Remaining emails were not sent. Limit resets tomorrow.' })
    } else if (succeeded.length > 0) {
      const nextReviewDraft = succeeded.includes(preview?.id) ? findNextReviewDraft(succeeded) : null
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
    const targetDraft = ids.length === 1 ? drafts.find(d => d.id === ids[0]) : null
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
      markSent(ids)
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

  const deleteDrafts = async (ids: string[]) => {
    setDeleting(true)
    try {
      await deleteEmails(ids)
      setDrafts(prev => prev.filter(d => !ids.includes(d.id)))
      setSelected(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next })
      if (preview && ids.includes(preview.id)) {
        const nextDraft = sorted.find(d => !ids.includes(d.id) && d.id !== preview.id)
        setPreview(nextDraft || null)
        setEditing(false)
      }
      setToast({
        type: 'success',
        title: ids.length === 1 ? 'Draft deleted' : `${ids.length} drafts deleted`,
        message: '',
      })
    } catch (err: any) {
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
    <div className="flex min-h-full flex-col lg:flex-row">
      <Toast toast={toast} onClose={() => setToast(null)} />
      {/* Main list */}
      <div className={`flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 ${preview ? 'lg:pr-4' : ''} ${focusMode ? 'hidden' : ''}`}>
        <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <div className="segmented-control">
              <button onClick={() => setTab('draft')} className={`segmented-chip ${tab === 'draft' ? 'segmented-chip-active' : ''}`}>Drafts</button>
              <button onClick={() => setTab('sent')} className={`segmented-chip ${tab === 'sent' ? 'segmented-chip-active' : ''}`}>Sent</button>
            </div>
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
                    ? 'bg-primary text-white'
                    : 'bg-white text-muted border border-slate-100 hover:bg-slate-50 hover:text-dark'
                }`}
              >
                {option.label} <span className={reviewFilter === option.id ? 'text-white/75' : 'text-muted/70'}>{option.count}</span>
              </button>
            ))}
          </div>
        )}

        <div className="card overflow-x-auto p-0">
          <table className="min-w-[760px] w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-slate-300"
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
            <tbody className="divide-y divide-slate-100">
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
                          ? 'No sent emails yet'
                          : reviewFilter === 'all'
                            ? 'No drafts ready for review'
                            : 'No drafts in this queue'
                      }
                      description={
                        tab === 'sent'
                          ? 'Sent emails will appear here after Gmail accepts them.'
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
                  className={`cursor-pointer transition-colors hover:bg-slate-50 ${preview?.id === draft.id ? 'bg-slate-50' : ''}`}
                >
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(draft.id)}
                      onChange={() => toggleOne(draft.id)}
                      className="rounded border-slate-300"
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
                  <td className="px-4 py-3 text-muted">{getCompanyName(draft) || '—'}</td>
                  <td className="px-4 py-3 text-dark max-w-xs">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{draft.subject || '(no subject)'}</span>
                      {tab === 'draft' && (() => {
                        const status = getDraftReadiness(draft)
                        return (
                          <Pill
                            variant={status.label === 'Ready' ? 'success' : 'warning'}
                            icon={status.icon}
                            className="shrink-0"
                          >
                            {status.label}
                          </Pill>
                        )
                      })()}
                    </div>
                    <div className="truncate text-xs text-muted">{stripHtml(draft.body)}</div>
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
                      <span className="inline-flex items-center justify-end gap-1 text-xs font-medium text-emerald-700">
                        <CheckCircle2 size={12} /> Sent
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Preview / edit panel */}
      {preview && (
        <div className={`flex shrink-0 flex-col border-t border-slate-100 bg-white lg:border-t-0 ${focusMode ? 'w-full flex-1' : 'w-full lg:w-[38%] lg:min-w-[440px] lg:max-w-[600px] lg:border-l'}`}>
          {/* Panel header */}
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-dark truncate">{getRecipientName(preview)}</p>
                {previewIndex >= 0 && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-muted">
                    {previewIndex + 1} of {sorted.length}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted truncate">
                {getRecipient(preview) || getCompanyName(preview) || ''}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 lg:ml-3">
              {/* Navigation */}
              <div className="flex items-center rounded-full bg-slate-50 p-0.5">
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

              {/* Edit / Save / Cancel */}
              {!editing ? (
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
              )}

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
                  <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-card">
                    <button
                      type="button"
                      onClick={() => { setFocusMode(m => !m); setMoreMenuOpen(false) }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-muted hover:bg-slate-50 hover:text-dark"
                    >
                      {focusMode ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                      {focusMode ? 'Exit focus mode' : 'Focus mode'}
                    </button>
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
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
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
              {editing ? (
                <input
                  type="text"
                  value={editSubject}
                  onChange={e => setEditSubject(e.target.value)}
                  className="input w-full text-sm"
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
                  value={editBody}
                  onChange={e => setEditBody(e.target.value)}
                  rows={16}
                  className="input w-full resize-y text-sm leading-relaxed"
                  placeholder="Email body…"
                />
              ) : (
                <div
                  className="max-w-[68ch] rounded-2xl border border-slate-100 bg-white px-4 py-4 text-[15px] leading-7 text-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(textToHtml(preview.body)) }}
                />
              )}
            </div>

            {/* Attachments */}
            {tab === 'draft' && !editing && (() => {
              const fileLibrary: Array<{ id: string; fileName: string; size: number }> = workspaceConfig?.files || []
              const attachedIds: string[] = Array.isArray(preview.attachmentIds) ? preview.attachmentIds : []
              const attached = fileLibrary.filter(f => attachedIds.includes(f.id))
              const available = fileLibrary.filter(f => !attachedIds.includes(f.id))

              const toggleAttachment = async (fileId: string, add: boolean) => {
                const next = add ? [...attachedIds, fileId] : attachedIds.filter(id => id !== fileId)
                setPreview(p => p ? { ...p, attachmentIds: next } : p)
                setDrafts(prev => prev.map(d => d.id === preview.id ? { ...d, attachmentIds: next } : d))
                try { await updateEmailAttachments(preview.id, next) } catch {
                  setPreview(p => p ? { ...p, attachmentIds: attachedIds } : p)
                }
              }

              if (fileLibrary.length === 0) return null
              return (
                <div className="border-t border-slate-100 pt-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/70">Attachments</p>
                  <div className="space-y-1">
                    {attached.map(f => (
                      <div key={f.id} className="flex items-center gap-2 rounded-lg border border-primary/15 bg-primary/5 px-2.5 py-1.5">
                        <Paperclip size={11} className="shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-dark">{f.fileName}</span>
                        <button type="button" onClick={() => toggleAttachment(f.id, false)} className="shrink-0 text-muted hover:text-dark"><X size={11} /></button>
                      </div>
                    ))}
                    {available.length > 0 && (
                      <select
                        value=""
                        onChange={e => { if (e.target.value) toggleAttachment(e.target.value, true) }}
                        className="select text-xs py-1.5"
                      >
                        <option value="">+ Add attachment</option>
                        {available.map(f => <option key={f.id} value={f.id}>{f.fileName}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* Meta */}
            <div className="border-t border-slate-100 pt-4 space-y-1.5">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/70">Details</p>
              <div className="flex justify-between text-xs">
                <span className="text-muted">Status</span>
                {tab === 'sent' ? (
                  <Badge variant="sent">Sent</Badge>
                ) : (
                  <Badge variant={getDraftReadiness(preview).label === 'Ready' ? 'ready' : 'paused'}>
                    {getDraftReadiness(preview).label}
                  </Badge>
                )}
              </div>
              <div className="flex justify-between gap-4 text-xs">
                <span className="text-muted">Recipient</span>
                <span className="truncate text-dark">{getRecipient(preview) || 'Missing'}</span>
              </div>
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
              {preview.userLead?.company?.name && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted">Company</span>
                  <span className="text-dark">{preview.userLead.company.name}</span>
                </div>
              )}
            </div>
          </div>
          <ShortcutHint editing={editing} canSend={tab === 'draft' && canSendDraft(preview)} />
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
          if (remaining < (batchSendConfirm?.length ?? 0)) return `${base} You have ${remaining} send${remaining !== 1 ? 's' : ''} left today (limit: ${batchDailyInfo.dailyMax}/day) — only ${remaining} of ${batchSendConfirm?.length} will be sent.`
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
    </div>
  )
}

function ShortcutHint({ editing, canSend }) {
  if (editing) {
    return (
      <div className="hidden border-t border-slate-100 px-5 py-2 text-[11px] text-muted/80 sm:flex sm:items-center sm:gap-3">
        <Keyboard size={11} />
        <Kbd>esc</Kbd> cancel
        <Kbd>⌘</Kbd>+<Kbd>↵</Kbd> save (after exit)
      </div>
    )
  }
  return (
    <div className="hidden border-t border-slate-100 px-5 py-2 text-[11px] text-muted/80 sm:flex sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1">
      <Keyboard size={11} />
      <span><Kbd>←</Kbd> <Kbd>→</Kbd> prev/next</span>
      <span><Kbd>e</Kbd> edit</span>
      {canSend && <span><Kbd>⌘</Kbd>+<Kbd>↵</Kbd> send</span>}
      <span><Kbd>x</Kbd> select</span>
      <span><Kbd>f</Kbd> focus</span>
      <span><Kbd>esc</Kbd> close</span>
    </div>
  )
}

function Kbd({ children }) {
  return <kbd className="rounded border border-slate-200 bg-slate-50 px-1 text-[10px] font-medium text-muted">{children}</kbd>
}
