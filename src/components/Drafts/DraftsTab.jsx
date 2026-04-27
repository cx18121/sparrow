import React, { useEffect, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import {
  Send, X, RefreshCw, ChevronDown, ChevronUp, Pencil, Check, CheckCircle2,
  AlertCircle, FileText, ChevronLeft, ChevronRight, UserRound, Building2, Mail,
} from 'lucide-react'
import { fetchEmails, updateEmail, sendEmail } from '../../lib/api'
import Badge from '../ui/Badge'
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

export default function DraftsTab({ onNavigate }) {
  const [tab, setTab] = useState('draft')
  const [reviewFilter, setReviewFilter] = useState('all')
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [preview, setPreview] = useState(null)
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState(null)
  const [sortKey, setSortKey] = useState('createdAt')
  const [sortDir, setSortDir] = useState('desc')

  // Edit state
  const [editing, setEditing] = useState(false)
  const [editSubject, setEditSubject] = useState('')
  const [editBody, setEditBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const [loadCount, setLoadCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setDrafts([])
    setSelected(new Set())
    setPreview(null)
    fetchEmails({ status: tab, limit: '200' })
      .then(res => {
        if (!cancelled) setDrafts(res?.items || [])
      })
      .catch(err => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [loadCount, tab])

  const load = () => setLoadCount(c => c + 1)

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

  const markSent = async (ids) => {
    const sendableIds = ids.filter(id => {
      const draft = drafts.find(d => d.id === id)
      return draft && canSendDraft(draft)
    })
    const skippedCount = ids.length - sendableIds.length

    if (sendableIds.length === 0) {
      setToast({
        type: 'info',
        title: 'Review needed before sending',
        message: 'Add a recipient, subject, and body before sending this draft.',
      })
      return
    }

    if (skippedCount > 0) {
      setToast({
        type: 'info',
        title: `${skippedCount} draft${skippedCount !== 1 ? 's' : ''} skipped`,
        message: 'Only drafts marked Ready were sent.',
      })
    }

    setSending(true)
    try {
      const results = await Promise.allSettled(sendableIds.map(id => sendEmail(id)))
      const failed = results
        .map((r, i) => r.status === 'rejected' ? (r.reason?.message || 'Send failed') : null)
        .filter(Boolean)
      if (failed.length) {
        setToast({
          type: 'error',
          title: `${failed.length} email${failed.length !== 1 ? 's' : ''} failed to send`,
          message: failed.slice(0, 2).join(' '),
        })
      }
      const succeeded = sendableIds.filter((_, i) => results[i].status === 'fulfilled')
      if (succeeded.length) {
        const nextReviewDraft = succeeded.includes(preview?.id) ? findNextReviewDraft(succeeded) : null
        setToast({
          type: 'success',
          title: succeeded.length === 1 ? 'Email sent' : `${succeeded.length} emails sent`,
          message: nextReviewDraft ? 'Moved to Sent. The next ready draft is open.' : 'Moved from Drafts to Sent.',
          action: {
            label: 'View sent',
            onClick: () => {
              setTab('sent')
              setToast(null)
            },
          },
        })
        setDrafts(prev => prev.filter(d => !succeeded.includes(d.id)))
        setSelected(prev => { const next = new Set(prev); succeeded.forEach(id => next.delete(id)); return next })
        if (preview && succeeded.includes(preview.id)) {
          setPreview(nextReviewDraft)
          setEditing(false)
        }
      }
    } finally {
      setSending(false)
    }
  }

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <ChevronDown size={11} className="text-gray-300" />
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
      <div className={`flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 ${preview ? 'lg:pr-4' : ''}`}>
        <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <div className="segmented-control">
              <button onClick={() => setTab('draft')} className={`segmented-chip ${tab === 'draft' ? 'segmented-chip-active' : ''}`}>Drafts</button>
              <button onClick={() => setTab('sent')} className={`segmented-chip ${tab === 'sent' ? 'segmented-chip-active' : ''}`}>Sent</button>
            </div>
            <p className="text-sm text-muted">
              {loading ? 'Loading…' : `${drafts.length} ${tab === 'sent' ? 'sent' : 'draft'}${drafts.length !== 1 ? 's' : ''}`}
            </p>
            {tab === 'draft' && !loading && drafts.length > 0 && (
              <p className="text-xs text-muted">
                {readyCount} ready, {needsWorkCount} need{needsWorkCount === 1 ? 's' : ''} review
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {tab === 'draft' && selectedArr.length > 0 && (
              <button
                onClick={() => markSent(selectedArr)}
                disabled={sending}
                className="btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3"
              >
                <Send size={13} />
                {sending ? 'Sending…' : `Send ${selectedArr.length}`}
              </button>
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
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
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
                    : 'bg-white/80 text-muted hover:bg-white hover:text-dark'
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
                  <td colSpan={6} className="px-4 py-12">
                    <div className="mx-auto flex max-w-sm flex-col items-center text-center">
                      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <FileText size={18} />
                      </div>
                      <p className="text-sm font-medium text-dark">
                        {tab === 'sent'
                          ? 'No sent emails yet'
                          : reviewFilter === 'all'
                            ? 'No drafts ready for review'
                            : 'No drafts in this queue'}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-muted">
                        {tab === 'sent'
                          ? 'Sent emails will appear here after Gmail accepts them.'
                          : reviewFilter === 'all'
                            ? 'Generate an email from a saved contact, then review and send it here.'
                            : 'Switch filters or refresh Drafts to keep reviewing.'}
                      </p>
                      {tab === 'draft' && onNavigate && (
                        <button type="button" onClick={() => onNavigate('contacts')} className="btn-primary mt-4 text-xs">
                          Go to Contacts
                        </button>
                      )}
                    </div>
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
                        const Icon = status.icon
                        return (
                          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            status.label === 'Ready'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}>
                            <Icon size={10} /> {status.label}
                          </span>
                        )
                      })()}
                    </div>
                    <div className="truncate text-xs text-muted">{stripHtml(draft.body)}</div>
                  </td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDate(tab === 'sent' ? draft.sentAt : draft.createdAt)}</td>
                  <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                    {tab === 'draft' && (
                      <button
                        onClick={() => markSent([draft.id])}
                        disabled={sending || !canSendDraft(draft)}
                        title={canSendDraft(draft) ? 'Send email' : 'Review needed before sending'}
                        className="btn-ghost px-2 py-1 text-xs flex items-center gap-1 ml-auto hover:text-primary disabled:opacity-40"
                      >
                        <Send size={11} /> Send
                      </button>
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
        <div className="flex w-full shrink-0 flex-col border-t border-slate-100 bg-white lg:w-[480px] lg:border-l lg:border-t-0">
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
              <div className="flex items-center rounded-full bg-slate-50 p-0.5">
                <button
                  type="button"
                  onClick={() => movePreview(-1)}
                  disabled={!hasPreviousDraft}
                  className="btn-ghost p-1.5 disabled:opacity-30"
                  title="Previous draft"
                >
                  <ChevronLeft size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => movePreview(1)}
                  disabled={!hasNextDraft}
                  className="btn-ghost p-1.5 disabled:opacity-30"
                  title="Next draft"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
              {!editing ? (
                <>
                  <button
                    onClick={startEdit}
                    className="btn-ghost flex items-center gap-1.5 text-xs py-1 px-2.5 text-muted hover:text-dark"
                  >
                    <Pencil size={11} /> Edit
                  </button>
                  {tab === 'draft' && (
                    <button
                      onClick={() => markSent([preview.id])}
                      disabled={sending || !canSendDraft(preview)}
                      title={canSendDraft(preview) ? 'Send email' : 'Review needed before sending'}
                      className="btn-primary flex items-center gap-1.5 text-xs py-1 px-2.5"
                    >
                      <Send size={11} /> Send
                    </button>
                  )}
                </>
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
              <button
                onClick={() => { setPreview(null); setEditing(false) }}
                className="btn-ghost p-1 text-muted hover:text-dark"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {saveError && (
            <div className="mx-5 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{saveError}</div>
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/70 mb-1">Subject</p>
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
                  className="input w-full resize-y font-mono text-sm leading-relaxed"
                  placeholder="Email body…"
                />
              ) : (
                <div
                  className="max-w-[68ch] rounded-2xl border border-slate-100 bg-white px-4 py-4 text-[15px] leading-7 text-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(textToHtml(preview.body)) }}
                />
              )}
            </div>

            {/* Meta */}
            <div className="pt-2 border-t border-slate-100 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/70">Details</p>
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
        </div>
      )}
    </div>
  )
}
