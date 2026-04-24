import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Send, X, RefreshCw, ChevronDown, ChevronUp, Pencil, Check } from 'lucide-react'
import { fetchEmails, updateEmail } from '../../lib/api'
import Badge from '../ui/Badge'

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

export default function DraftsTab() {
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [preview, setPreview] = useState(null)
  const [sending, setSending] = useState(false)
  const [sortKey, setSortKey] = useState('createdAt')
  const [sortDir, setSortDir] = useState('desc')

  // Edit state
  const [editing, setEditing] = useState(false)
  const [editSubject, setEditSubject] = useState('')
  const [editBody, setEditBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const cancelRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    cancelRef.current = false
    try {
      const res = await fetchEmails({ status: 'draft', limit: '200' })
      if (!cancelRef.current) {
        setDrafts(res?.items || [])
        setSelected(new Set())
      }
    } catch (err) {
      if (!cancelRef.current) setError(err.message)
    } finally {
      if (!cancelRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    return () => { cancelRef.current = true }
  }, [load])

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

  const sorted = [...drafts].sort((a, b) => {
    let av, bv
    if (sortKey === 'name') {
      av = a.contact?.name || ''
      bv = b.contact?.name || ''
    } else if (sortKey === 'company') {
      av = a.userLead?.company?.name || ''
      bv = b.userLead?.company?.name || ''
    } else if (sortKey === 'subject') {
      av = a.subject || ''
      bv = b.subject || ''
    } else {
      av = a.createdAt || ''
      bv = b.createdAt || ''
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

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
    setSending(true)
    const sentAt = new Date().toISOString()
    try {
      await Promise.all(ids.map(id => updateEmail({ id, status: 'sent', sentAt })))
      setDrafts(prev => prev.filter(d => !ids.includes(d.id)))
      setSelected(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next })
      if (preview && ids.includes(preview.id)) { setPreview(null); setEditing(false) }
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

  return (
    <div className="flex h-full">
      {/* Main list */}
      <div className={`flex flex-col flex-1 min-w-0 p-8 ${preview ? 'pr-4' : ''}`}>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-dark">Draft Emails</h2>
            <p className="mt-0.5 text-sm text-muted">
              {loading ? 'Loading…' : `${drafts.length} draft${drafts.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedArr.length > 0 && (
              <button
                onClick={() => markSent(selectedArr)}
                disabled={sending}
                className="btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3"
              >
                <Send size={13} />
                {sending ? 'Sending…' : `Mark ${selectedArr.length} as Sent`}
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

        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
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
                  <td colSpan={6} className="px-4 py-12 text-center text-muted">
                    No draft emails. Generate emails from the Contacts tab and save them as drafts.
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
                    {draft.contact?.name || '—'}
                    {draft.contact?.title && (
                      <div className="text-xs text-muted font-normal">{draft.contact.title}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{draft.userLead?.company?.name || '—'}</td>
                  <td className="px-4 py-3 text-dark max-w-xs">
                    <div className="truncate">{draft.subject || '(no subject)'}</div>
                    <div className="truncate text-xs text-muted">{stripHtml(draft.body)}</div>
                  </td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDate(draft.createdAt)}</td>
                  <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => markSent([draft.id])}
                      disabled={sending}
                      className="btn-ghost px-2 py-1 text-xs flex items-center gap-1 ml-auto hover:text-primary disabled:opacity-40"
                    >
                      <Send size={11} /> Send
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Preview / edit panel */}
      {preview && (
        <div className="w-[440px] shrink-0 border-l border-slate-100 flex flex-col bg-white">
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              <p className="font-medium text-dark truncate">{preview.contact?.name || 'Draft'}</p>
              <p className="text-xs text-muted truncate">
                {preview.contact?.email || preview.userLead?.company?.name || ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {!editing ? (
                <>
                  <button
                    onClick={startEdit}
                    className="btn-ghost flex items-center gap-1.5 text-xs py-1 px-2.5 text-muted hover:text-dark"
                  >
                    <Pencil size={11} /> Edit
                  </button>
                  <button
                    onClick={() => markSent([preview.id])}
                    disabled={sending}
                    className="btn-primary flex items-center gap-1.5 text-xs py-1 px-2.5"
                  >
                    <Send size={11} /> Send
                  </button>
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
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
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
                <p className="text-sm font-medium text-dark">{preview.subject || '(no subject)'}</p>
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
                  className="input w-full text-sm resize-y font-mono leading-relaxed"
                  placeholder="Email body…"
                />
              ) : (
                <div
                  className="text-sm text-dark"
                  dangerouslySetInnerHTML={{ __html: textToHtml(preview.body) }}
                />
              )}
            </div>

            {/* Meta */}
            <div className="pt-2 border-t border-slate-100 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/70">Details</p>
              <div className="flex justify-between text-xs">
                <span className="text-muted">Status</span>
                <Badge variant="draft">draft</Badge>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted">Created</span>
                <span className="text-dark">{formatDate(preview.createdAt)}</span>
              </div>
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
