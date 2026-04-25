import React, { useState, useMemo } from 'react'
import {
  Search, Trash2, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, Download, Sparkles,
} from 'lucide-react'
import Papa from 'papaparse'
import Badge from '../ui/Badge'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import { format } from 'date-fns'
import { generateEmail, createEmail } from '../../lib/api'

const PAGE_SIZE = 10
const STATUSES = ['NEW', 'SAVED', 'EMAILED', 'REJECTED']

// Badge variants are lowercase; map LeadStatus to the nearest Badge variant.
const STATUS_BADGE = {
  NEW:      'draft',
  SAVED:    'active',
  EMAILED:  'completed',
  REJECTED: 'bounced',
}

const STATUS_STYLE = {
  NEW:      'bg-slate-100 text-slate-600',
  SAVED:    'bg-emerald-50 text-emerald-700',
  EMAILED:  'bg-blue-50 text-blue-700',
  REJECTED: 'bg-red-50 text-red-600',
}

const getName = (lead) => lead.contact?.name || ''
const getEmail = (lead) => lead.contact?.email || ''
const getCompany = (lead) => lead.company?.name || ''
const getTitle = (lead) => lead.contact?.title || ''
// When no Contact record exists (lead saved from Apollo preview without enrichment),
// the name/title are embedded in the notes field.
const getNotesName = (lead) => {
  if (lead.contact?.name) return lead.contact.name
  const m = lead.notes?.match(/^Apollo contact: ([^ ]+) /)
  return m ? m[1] : ''
}
const getNotesTitle = (lead) => {
  if (lead.contact?.title) return lead.contact.title
  const m = lead.notes?.match(/— (.+?) \//)
  return m ? m[1] : ''
}

export default function ContactsTab({ leads = [], templates = [], onUpdate, onDelete, workspaceConfig }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(1)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const [generateTarget, setGenerateTarget] = useState(null)
  const [generateTemplateId, setGenerateTemplateId] = useState(
    workspaceConfig?.templateId || ''
  )
  const [generateTone, setGenerateTone] = useState('')
  const [generatedSubject, setGeneratedSubject] = useState('')
  const [generatedBody, setGeneratedBody] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generateError, setGenerateError] = useState(null)

  const openGenerate = (lead) => {
    setGenerateTarget(lead)
    setGenerateTemplateId(workspaceConfig?.templateId || '')
    setGenerateTone('')
    setGeneratedSubject('')
    setGeneratedBody('')
    setGenerateError(null)
  }

  const closeGenerate = () => {
    setGenerateTarget(null)
    setGenerating(false)
    setSaving(false)
  }

  const runGenerate = async () => {
    if (!generateTarget) return
    setGenerating(true)
    setGenerateError(null)
    try {
      const res = await generateEmail({
        userLeadId: generateTarget.id,
        templateId: generateTemplateId || undefined,
        tone: generateTone || undefined,
      })
      setGeneratedSubject(res.subject || '')
      setGeneratedBody(res.body || '')
    } catch (err) {
      setGenerateError(err.message || 'Failed to generate email')
    } finally {
      setGenerating(false)
    }
  }

  const saveDraft = async () => {
    if (!generateTarget || !generatedSubject || !generatedBody) return
    setSaving(true)
    setGenerateError(null)
    try {
      await createEmail({
        userLeadId: generateTarget.id,
        subject: generatedSubject,
        body: generatedBody,
        status: 'draft',
      })
      closeGenerate()
    } catch (err) {
      setGenerateError(err.message || 'Failed to save draft')
      setSaving(false)
    }
  }

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <ChevronUp size={11} className="text-gray-300" />
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="text-primary" />
      : <ChevronDown size={11} className="text-primary" />
  }

  const getSortValue = (lead, key) => {
    switch (key) {
      case 'name': {
        const n = getName(lead) || getNotesName(lead)
        return n.toLowerCase()
      }
      case 'email':   return getEmail(lead).toLowerCase()
      case 'company': return getCompany(lead).toLowerCase()
      case 'title': {
        const t = getTitle(lead) || getNotesTitle(lead)
        return t.toLowerCase()
      }
      case 'status':  return (lead.status || '').toLowerCase()
      case 'addedAt': return lead.addedAt || ''
      default: return ''
    }
  }

  const filtered = useMemo(() => {
    let data = leads
    if (search) {
      const q = search.toLowerCase()
      data = data.filter(l =>
        (getName(l) || getNotesName(l)).toLowerCase().includes(q) ||
        getEmail(l).toLowerCase().includes(q) ||
        getCompany(l).toLowerCase().includes(q) ||
        (getTitle(l) || getNotesTitle(l)).toLowerCase().includes(q)
      )
    }
    if (statusFilter !== 'all') data = data.filter(l => l.status === statusFilter)
    data = [...data].sort((a, b) => {
      const av = getSortValue(a, sortKey)
      const bv = getSortValue(b, sortKey)
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ?  1 : -1
      return 0
    })
    return data
  }, [leads, search, statusFilter, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const changeStatus = (lead, status) => {
    if (status === lead.status) return
    onUpdate({ id: lead.id, status }).catch(err => console.error('Failed to update lead', err))
  }

  const exportCSV = () => {
    const csv = Papa.unparse(filtered.map(l => ({
      name:    getName(l),
      email:   getEmail(l),
      title:   getTitle(l),
      company: getCompany(l),
      status:  l.status,
      added:   l.addedAt,
    })))
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'leads.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page-shell">
      <div className="flex flex-wrap items-center justify-between gap-3 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Saved leads</p>
          <p className="mt-1 text-sm text-muted">Leads you've saved from lead search appear here.</p>
        </div>
        <button onClick={exportCSV} className="btn-secondary text-xs" disabled={filtered.length === 0}>
          <Download size={13} /> Export CSV
        </button>
      </div>

      <div className="page-toolbar">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search name, email, company, or title…"
                className="input pl-9"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
              className="select w-full sm:w-44"
            >
              <option value="all">All statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <p className="text-sm text-muted">
            {filtered.length} lead{filtered.length !== 1 ? 's' : ''} across {totalPages} page{totalPages !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="table-shell">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-[rgba(248,250,252,0.86)]">
              {[
                ['name', 'Name'],
                ['email', 'Email'],
                ['company', 'Company'],
                ['title', 'Title'],
                ['status', 'Status'],
                ['addedAt', 'Added'],
              ].map(([key, label]) => (
                <th key={key} className="px-5 py-4 text-left">
                  <button
                    onClick={() => toggleSort(key)}
                    className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80 transition-colors hover:text-dark"
                  >
                    {label} <SortIcon col={key} />
                  </button>
                </th>
              ))}
              <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginated.map(lead => (
              <tr key={lead.id} className="transition-colors hover:bg-[rgba(248,250,252,0.72)]">
                <td className="px-5 py-4 font-medium text-dark">{getName(lead) || getNotesName(lead) || '—'}</td>
                <td className="px-5 py-4 text-muted">{getEmail(lead) || '—'}</td>
                <td className="px-5 py-4 text-muted">{getCompany(lead) || '—'}</td>
                <td className="px-5 py-4 text-muted">{getTitle(lead) || getNotesTitle(lead) || '—'}</td>
                <td className="px-5 py-4">
                  <select
                    value={lead.status}
                    onChange={e => changeStatus(lead, e.target.value)}
                    className={`rounded-full border-0 text-xs font-medium py-1 pl-2.5 pr-6 cursor-pointer focus:ring-1 focus:ring-primary/30 ${STATUS_STYLE[lead.status] || STATUS_STYLE.NEW}`}
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="px-5 py-4 text-muted">
                  {lead.addedAt ? format(new Date(lead.addedAt), 'MMM d, yyyy') : '—'}
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => openGenerate(lead)}
                      disabled={!lead.contact?.email && !lead.apolloPersonId}
                      title={lead.contact?.email ? 'Generate email with Claude' : lead.apolloPersonId ? 'Generating will reveal contact via Apollo' : 'Lead has no contact email'}
                      className="btn-ghost px-2 py-1 hover:text-primary disabled:opacity-40"
                    >
                      <Sparkles size={12} />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(lead.id)}
                      className="btn-ghost px-2 py-1 hover:text-red-500"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10">
                  <div className="empty-state border-0 bg-transparent py-10 shadow-none">
                    No leads yet. Save leads from the lead search to see them here.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4">
            <p className="text-xs text-muted">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-ghost px-2 py-1 disabled:opacity-40"
              >
                <ChevronLeft size={13} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      p === page
                        ? 'bg-primary text-white shadow-[0_10px_24px_rgba(27,110,243,0.2)]'
                        : 'text-muted hover:bg-white hover:text-dark'
                    }`}
                  >
                    {p}
                  </button>
                )
              })}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-ghost px-2 py-1 disabled:opacity-40"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          const victim = deleteTarget
          setDeleteTarget(null)
          onDelete(victim).catch(err => console.error('Failed to delete lead', err))
        }}
        title="Remove lead"
        message="Remove this lead from your saved list? This doesn't affect the underlying company or contact data."
      />

      <Modal
        open={!!generateTarget}
        onClose={closeGenerate}
        title={generateTarget ? `Generate email to ${getName(generateTarget) || getEmail(generateTarget) || 'contact'}` : 'Generate email'}
        size="lg"
      >
        <div className="px-6 py-4 space-y-4">
          {generateTarget && (
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3 text-xs text-muted">
              <div><span className="font-semibold text-dark">{getName(generateTarget) || '—'}</span>{getTitle(generateTarget) ? ` · ${getTitle(generateTarget)}` : ''}</div>
              <div className="text-muted/80">{getCompany(generateTarget)} · {getEmail(generateTarget) || 'no email'}</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Base template (optional)</label>
              <select
                value={generateTemplateId}
                onChange={e => setGenerateTemplateId(e.target.value)}
                className="select"
                disabled={generating}
              >
                <option value="">None — generate from scratch</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Tone hint (optional)</label>
              <input
                value={generateTone}
                onChange={e => setGenerateTone(e.target.value)}
                placeholder="e.g. curious, low-key, technical"
                className="input"
                disabled={generating}
              />
            </div>
          </div>

          <div>
            <button
              onClick={runGenerate}
              disabled={generating || !generateTarget}
              className="btn-primary w-full justify-center"
            >
              <Sparkles size={14} />
              {generating ? 'Generating…' : generatedSubject ? 'Regenerate' : 'Generate with Claude'}
            </button>
          </div>

          {generateError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {generateError}
            </div>
          )}

          {(generatedSubject || generatedBody || generating) && (
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <div>
                <label className="label">Subject</label>
                <input
                  value={generatedSubject}
                  onChange={e => setGeneratedSubject(e.target.value)}
                  placeholder={generating ? 'Generating…' : ''}
                  className="input"
                  disabled={generating}
                />
              </div>
              <div>
                <label className="label">Body</label>
                <textarea
                  value={generatedBody}
                  onChange={e => setGeneratedBody(e.target.value)}
                  placeholder={generating ? 'Generating…' : ''}
                  rows={10}
                  className="input font-mono text-xs leading-relaxed"
                  disabled={generating}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={closeGenerate} className="btn-secondary" disabled={saving}>
              Cancel
            </button>
            <button
              onClick={saveDraft}
              disabled={saving || generating || !generatedSubject || !generatedBody}
              className="btn-primary"
            >
              {saving ? 'Saving…' : 'Save as draft'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
