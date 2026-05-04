import React, { useState, useMemo } from 'react'
import { useAppData } from '../../contexts/AppDataContext'
import { useToast } from '../../hooks/useToast'
import {
  Search, Trash2, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, Download, Sparkles, UserPlus, CheckSquare, Square,
} from 'lucide-react'
import Papa from 'papaparse'
import Badge from '../ui/Badge'
import Banner from '../ui/Banner'
import EmptyState from '../ui/EmptyState'
import { VARIANT_STYLES } from '../ui/Pill'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import Toast from '../ui/Toast'
import { format } from 'date-fns'
import { useDraftFlow } from '../../hooks/useDraftFlow'

const PAGE_SIZE = 10
const STATUSES = ['SAVED', 'EMAILED', 'NO_RESPONSE', 'DECLINED']
const STATUS_LABELS: Record<string, string> = {
  SAVED: 'Saved',
  EMAILED: 'Emailed',
  NO_RESPONSE: 'No response',
  DECLINED: 'Declined',
}

const STATUS_STYLE = {
  SAVED:       VARIANT_STYLES.success,
  EMAILED:     VARIANT_STYLES.info,
  NO_RESPONSE: VARIANT_STYLES.warning,
  DECLINED:    VARIANT_STYLES.danger,
}

// Normalised row shape — works for both UserLead rows and CustomContact rows.
// CustomContact rows carry a `_custom: true` flag.
const getName    = (row) => row._custom ? (row.name || '') : (row.contact?.name || '')
const getEmail   = (row) => row._custom ? (row.email || '') : (row.contact?.email || '')
const getCompany = (row) => row._custom ? (row.companyName || '') : (row.company?.name || '')
const getTitle   = (row) => row._custom ? (row.title || '') : (row.contact?.title || '')
const getRowKey  = (row) => `${row._custom ? 'cc' : 'lead'}-${row.id}`
const canGenerateForRow = (row) => Boolean(getEmail(row) || row.apolloPersonId || row._custom)

const getNotesName = (lead) => {
  if (lead._custom || lead.contact?.name) return getName(lead)
  const m = lead.notes?.match(/^Apollo contact: ([^ ]+) /)
  return m ? m[1] : ''
}
const getNotesTitle = (lead) => {
  if (lead._custom || lead.contact?.title) return getTitle(lead)
  const m = lead.notes?.match(/— (.+?) \//)
  return m ? m[1] : ''
}

export default function ContactsTab({ workspaceConfig, onNavigate }) {
  const {
    leads,
    customContacts,
    templates,
    updateLead: onUpdate,
    deleteLead: onDelete,
    createCustomContact: onCreateCustomContact,
    updateCustomContact: onUpdateCustomContact,
    deleteCustomContact: onDeleteCustomContact,
    dataLoaded,
    hasResourceCache,
  } = useAppData()
  const isLoading = !dataLoaded && !hasResourceCache
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(1)
  const [deleteTarget, setDeleteTarget] = useState(null) // { id, custom }
  const [selectedKeys, setSelectedKeys] = useState(new Set())
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)

  // Generate email modal — flow is owned by useDraftFlow.
  const [generateTarget, setGenerateTarget] = useState(null)
  const [generateTemplateId, setGenerateTemplateId] = useState(workspaceConfig?.templateId || '')
  const [generateTone, setGenerateTone] = useState('')
  const [includeResumeBullet, setIncludeResumeBullet] = useState(false)
  const draftFlow = useDraftFlow()
  const { toast, setToast } = useToast()

  // Add custom contact modal
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', email: '', title: '', companyName: '' })
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState(null)

  // Merge leads + custom contacts into a single list
  const allRows = useMemo(() => [
    ...leads,
    ...customContacts.map(cc => ({ ...cc, _custom: true, status: cc.status || 'SAVED', addedAt: cc.createdAt })),
  ], [leads, customContacts])

  const openGenerate = (row) => {
    setGenerateTarget(row)
    const preferredId = workspaceConfig?.templateId || ''
    setGenerateTemplateId(templates.some(t => t.id === preferredId) ? preferredId : '')
    setGenerateTone('')
    setIncludeResumeBullet(false)
    draftFlow.reset()
  }

  const closeGenerate = () => {
    setGenerateTarget(null)
    draftFlow.reset()
  }

  const runGenerate = async () => {
    if (!generateTarget) return
    const target = generateTarget._custom
      ? { kind: 'custom' as const, id: generateTarget.id }
      : { kind: 'lead' as const, id: generateTarget.id }
    try {
      await draftFlow.generate(target, {
        templateId: generateTemplateId || undefined,
        tone: generateTone || undefined,
        includeResumeBullet,
      })
    } catch {
      // Error already captured in draftFlow.error
    }
  }

  const saveDraft = async () => {
    if (!generateTarget || !draftFlow.subject || !draftFlow.body) return
    const target = generateTarget._custom
      ? { kind: 'custom' as const, id: generateTarget.id }
      : { kind: 'lead' as const, id: generateTarget.id }
    try {
      await draftFlow.save(target)
      closeGenerate()
      setToast({
        type: 'success',
        title: 'Draft saved',
        message: 'Review it in Drafts.',
        action: onNavigate ? { label: 'Open Drafts', onClick: () => onNavigate('drafts') } : null,
      })
    } catch {
      // Error already captured in draftFlow.error
    }
  }

  const openAdd = () => {
    setAddForm({ name: '', email: '', title: '', companyName: '' })
    setAddError(null)
    setAddOpen(true)
  }

  const submitAdd = async () => {
    if (!addForm.name.trim() && !addForm.email.trim()) {
      setAddError('Enter at least a name or email.')
      return
    }
    setAddSaving(true)
    setAddError(null)
    try {
      await onCreateCustomContact({
        name: addForm.name.trim() || null,
        email: addForm.email.trim() || null,
        title: addForm.title.trim() || null,
        companyName: addForm.companyName.trim() || null,
      })
      setAddOpen(false)
    } catch (err) {
      setAddError(err.message || 'Failed to create contact')
    } finally {
      setAddSaving(false)
    }
  }

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <ChevronUp size={11} className="text-muted/40" />
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="text-primary" />
      : <ChevronDown size={11} className="text-primary" />
  }

  const getSortValue = (row, key) => {
    switch (key) {
      case 'name':    return (getName(row) || getNotesName(row)).toLowerCase()
      case 'email':   return getEmail(row).toLowerCase()
      case 'company': return getCompany(row).toLowerCase()
      case 'title':   return (getTitle(row) || getNotesTitle(row)).toLowerCase()
      case 'status':  return (row.status || '').toLowerCase()
      case 'addedAt': return row.addedAt || ''
      default: return ''
    }
  }

  const filtered = useMemo(() => {
    let data = allRows
    if (search) {
      const q = search.toLowerCase()
      data = data.filter(r =>
        (getName(r) || getNotesName(r)).toLowerCase().includes(q) ||
        getEmail(r).toLowerCase().includes(q) ||
        getCompany(r).toLowerCase().includes(q) ||
        (getTitle(r) || getNotesTitle(r)).toLowerCase().includes(q)
      )
    }
    if (statusFilter !== 'all') data = data.filter(r => r.status === statusFilter)
    data = [...data].sort((a, b) => {
      const av = getSortValue(a, sortKey)
      const bv = getSortValue(b, sortKey)
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ?  1 : -1
      return 0
    })
    return data
  }, [allRows, search, statusFilter, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const selectedRows = useMemo(() => {
    const selected = new Set(selectedKeys)
    return allRows.filter(row => selected.has(getRowKey(row)))
  }, [allRows, selectedKeys])
  const selectedEligibleRows = selectedRows.filter(canGenerateForRow)
  const visibleKeys = paginated.map(getRowKey)
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every(key => selectedKeys.has(key))
  const allFilteredSelected = filtered.length > 0 && filtered.every(row => selectedKeys.has(getRowKey(row)))

  const toggleOneSelected = (row) => {
    const key = getRowKey(row)
    setSelectedKeys(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const toggleVisibleSelected = () => {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        visibleKeys.forEach(key => next.delete(key))
      } else {
        visibleKeys.forEach(key => next.add(key))
      }
      return next
    })
  }

  const selectAllFiltered = () => {
    setSelectedKeys(new Set(filtered.map(getRowKey)))
  }

  const clearSelection = () => setSelectedKeys(new Set())

  const changeStatus = (lead, status) => {
    if (status === lead.status) return
    const handler = lead._custom ? onUpdateCustomContact : onUpdate
    if (!handler) return
    handler({ id: lead.id, status })
      .then(() => setToast({ type: 'success', title: `Marked as ${STATUS_LABELS[status]}` }))
      .catch(err => setToast({ type: 'error', title: 'Could not update status', message: err?.message || 'Please try again.' }))
  }

  const bulkGenerateDrafts = async () => {
    if (bulkGenerating || selectedEligibleRows.length === 0) return
    const preferredId = workspaceConfig?.templateId || undefined
    const templateId = preferredId && templates.some(t => t.id === preferredId) ? preferredId : undefined
    const targets = selectedEligibleRows.map(row => ({
      kind: row._custom ? 'custom' as const : 'lead' as const,
      id: row.id,
    }))
    setBulkGenerating(true)
    try {
      // Routes through useDraftFlow.bulkGenerate so the reentrancy guard +
      // generating flag are shared with single-draft generation. Bulk opts
      // into save:true inside the hook — different from preview-then-save.
      const { succeeded, failed, skipped } = await draftFlow.bulkGenerate(targets, { templateId, includeResumeBullet: false })
      if (skipped > 0) {
        setToast({ type: 'info', title: 'Generation already running', message: 'Wait for the current run to finish.' })
        return
      }
      setToast({
        type: failed ? 'info' : 'success',
        title: `${succeeded} draft${succeeded !== 1 ? 's' : ''} generated`,
        message: failed
          ? `${failed} contact${failed !== 1 ? 's' : ''} could not be generated. Check missing emails or API settings.`
          : 'Review and send from Drafts.',
        action: onNavigate && succeeded ? { label: 'Open Drafts', onClick: () => onNavigate('drafts') } : null,
      })
      if (succeeded) clearSelection()
    } finally {
      setBulkGenerating(false)
    }
  }

  const bulkDeleteSelected = async () => {
    if (bulkDeleting || selectedRows.length === 0) return
    setBulkDeleting(true)
    const rows = selectedRows
    const results = await Promise.allSettled(rows.map(row =>
      row._custom ? onDeleteCustomContact(row.id) : onDelete(row.id)
    ))
    const failed = results.filter(result => result.status === 'rejected').length
    const removed = rows.length - failed
    if (failed) {
      setToast({
        type: 'error',
        title: `${failed} contact${failed !== 1 ? 's' : ''} could not be removed`,
        message: removed ? `${removed} removed successfully.` : 'Try again.',
      })
    } else {
      setToast({
        type: 'success',
        title: `${removed} contact${removed !== 1 ? 's' : ''} removed`,
        message: null,
      })
    }
    clearSelection()
    setBulkDeleting(false)
  }

  const exportCSV = () => {
    const csv = Papa.unparse(filtered.map(r => ({
      name:    getName(r),
      email:   getEmail(r),
      title:   getTitle(r),
      company: getCompany(r),
      status:  r.status,
      added:   r.addedAt,
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
      <Toast toast={toast} onClose={() => setToast(null)} />
      <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="page-subtitle">Manage and email saved leads.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openAdd} className="btn-primary text-xs">
            <UserPlus size={13} /> Add contact
          </button>
          <button onClick={exportCSV} className="btn-secondary text-xs" disabled={isLoading || filtered.length === 0}>
            <Download size={13} /> Export CSV
          </button>
        </div>
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
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
            </select>
          </div>
          <p className="text-sm text-muted">
            {isLoading && allRows.length === 0
              ? 'Loading contacts...'
              : totalPages > 1
                ? `${filtered.length} contact${filtered.length !== 1 ? 's' : ''} across ${totalPages} pages`
                : `${filtered.length} contact${filtered.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      <div className="table-shell">
        {selectedRows.length > 0 && (
          <div className="flex flex-col gap-3 border-b border-warm-200 bg-warm-50/70 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted">
              <span className="font-medium text-dark">{selectedRows.length}</span> selected
              {selectedEligibleRows.length !== selectedRows.length && (
                <span className="ml-2 text-xs text-amber-600">
                  {selectedRows.length - selectedEligibleRows.length} cannot generate yet
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!allFilteredSelected && filtered.length > paginated.length && (
                <button type="button" onClick={selectAllFiltered} className="btn-ghost px-2 py-1 text-xs">
                  Select all {filtered.length}
                </button>
              )}
              <button type="button" onClick={clearSelection} className="btn-ghost px-2 py-1 text-xs" disabled={bulkGenerating || bulkDeleting}>
                Clear
              </button>
              <button
                type="button"
                onClick={() => setBulkConfirmOpen(true)}
                disabled={bulkGenerating || selectedEligibleRows.length === 0 || bulkDeleting}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                <Sparkles size={12} /> {bulkGenerating ? 'Generating...' : `Generate ${selectedEligibleRows.length} draft${selectedEligibleRows.length !== 1 ? 's' : ''}`}
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget({ bulk: true })}
                disabled={bulkGenerating || bulkDeleting}
                className="btn-danger px-3 py-1.5 text-xs"
              >
                <Trash2 size={12} /> Delete selected
              </button>
            </div>
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-warm-200 bg-warm-50/80">
              <th className="w-10 px-5 py-4 text-left">
                <button
                  type="button"
                  onClick={toggleVisibleSelected}
                  disabled={paginated.length === 0 || isLoading}
                  className="inline-flex text-muted transition-colors hover:text-dark disabled:opacity-40"
                  title={allVisibleSelected ? 'Deselect visible contacts' : 'Select visible contacts'}
                >
                  {allVisibleSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                </button>
              </th>
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
          <tbody className="divide-y divide-warm-200">
            {isLoading && allRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted">
                  Loading contacts...
                </td>
              </tr>
            ) : paginated.map(row => (
              <tr key={`${row._custom ? 'cc' : 'lead'}-${row.id}`} className="transition-colors hover:bg-warm-50/60">
                <td className="px-5 py-4">
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(getRowKey(row))}
                    onChange={() => toggleOneSelected(row)}
                    className="rounded border-warm-300"
                    aria-label={`Select ${getName(row) || getEmail(row) || 'contact'}`}
                  />
                </td>
                <td className="px-5 py-4 font-medium text-dark">
                  <span className="flex items-center gap-2">
                    {getName(row) || getNotesName(row) || '—'}
                    {row._custom && (
                      <span className="rounded-full bg-warm-100 px-2 py-0.5 text-[10px] font-medium text-warm-500">custom</span>
                    )}
                  </span>
                </td>
                <td className="px-5 py-4 text-muted">{getEmail(row) || '—'}</td>
                <td className="px-5 py-4 text-muted">{getCompany(row) || '—'}</td>
                <td className="px-5 py-4 text-muted">{getTitle(row) || getNotesTitle(row) || '—'}</td>
                <td className="px-5 py-4">
                  <select
                    value={row.status}
                    onChange={e => changeStatus(row, e.target.value)}
                    className={`rounded-full border-0 text-xs font-medium py-1 pl-2.5 pr-6 cursor-pointer focus:ring-1 focus:ring-primary/30 ${STATUS_STYLE[row.status] || STATUS_STYLE.SAVED}`}
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
                  </select>
                </td>
                <td className="px-5 py-4 text-muted">
                  {row.addedAt ? format(new Date(row.addedAt), 'MMM d, yyyy') : '—'}
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => openGenerate(row)}
                      disabled={!getEmail(row) && !row.apolloPersonId && !row._custom}
                      title={getEmail(row) ? 'Generate email with Claude' : row._custom ? 'Generate email with Claude' : row.apolloPersonId ? 'Generating will reveal contact via Apollo' : 'Lead has no contact email'}
                      className="btn-ghost flex items-center gap-1 px-2.5 py-1 text-xs hover:text-primary disabled:opacity-40"
                    >
                      <Sparkles size={12} /> Draft
                    </button>
                    <button
                      onClick={() => setDeleteTarget({ id: row.id, custom: !!row._custom })}
                      className="btn-ghost px-2 py-1 hover:text-red-500"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && paginated.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    title={search || statusFilter !== 'all' ? 'No contacts match these filters' : 'No contacts yet'}
                    description={
                      search || statusFilter !== 'all'
                        ? 'Clear the filter to see all contacts.'
                        : 'Find contacts in Discover or add one manually.'
                    }
                    action={
                      (search || statusFilter !== 'all') ? (
                        <button
                          type="button"
                          onClick={() => { setSearch(''); setStatusFilter('all'); setPage(1) }}
                          className="btn-secondary text-xs"
                        >
                          Clear filters
                        </button>
                      ) : (
                        onNavigate && (
                          <button type="button" onClick={() => onNavigate('leads')} className="btn-primary text-xs">
                            Discover leads
                          </button>
                        )
                      )
                    }
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-warm-200 px-5 py-4">
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
                        ? 'bg-primary text-white'
                        : 'text-muted hover:bg-warm-100/70 hover:text-dark'
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

      {/* Bulk generate confirm */}
      <ConfirmDialog
        open={bulkConfirmOpen}
        onClose={() => setBulkConfirmOpen(false)}
        onConfirm={() => { setBulkConfirmOpen(false); bulkGenerateDrafts() }}
        title="Generate drafts"
        message={`Generate drafts for ${selectedEligibleRows.length} contact${selectedEligibleRows.length !== 1 ? 's' : ''}? Each will use a Claude API call.`}
        confirmLabel={`Generate ${selectedEligibleRows.length} draft${selectedEligibleRows.length !== 1 ? 's' : ''}`}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          const victim = deleteTarget
          setDeleteTarget(null)
          if (victim.bulk) {
            bulkDeleteSelected()
            return
          }
          if (victim.custom) {
            onDeleteCustomContact(victim.id).catch(err => setToast({ type: 'error', title: 'Could not delete contact', message: err?.message || 'Please try again.' }))
          } else {
            onDelete(victim.id).catch(err => setToast({ type: 'error', title: 'Could not delete contact', message: err?.message || 'Please try again.' }))
          }
        }}
        title={deleteTarget?.bulk ? 'Remove selected contacts' : 'Remove contact'}
        message={deleteTarget?.bulk
          ? `Remove ${selectedRows.length} selected contact${selectedRows.length !== 1 ? 's' : ''}? This action cannot be undone.`
          : 'Remove this contact? This action cannot be undone.'}
        confirmLabel={deleteTarget?.bulk ? 'Remove selected' : 'Remove'}
      />

      {/* Add custom contact modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add custom contact" size="md">
        <div className="space-y-4 px-4 py-4 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="add-contact-name" className="label">Name</label>
              <input
                id="add-contact-name"
                value={addForm.name}
                onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Jane Smith"
                className="input"
                disabled={addSaving}
              />
            </div>
            <div>
              <label htmlFor="add-contact-email" className="label">Email</label>
              <input
                id="add-contact-email"
                value={addForm.email}
                onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                placeholder="jane@acme.com"
                className="input"
                type="email"
                disabled={addSaving}
              />
            </div>
            <div>
              <label htmlFor="add-contact-title" className="label">Title <span className="text-muted">(optional)</span></label>
              <input
                id="add-contact-title"
                value={addForm.title}
                onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Head of Engineering"
                className="input"
                disabled={addSaving}
              />
            </div>
            <div>
              <label htmlFor="add-contact-company" className="label">Company <span className="text-muted">(optional)</span></label>
              <input
                id="add-contact-company"
                value={addForm.companyName}
                onChange={e => setAddForm(f => ({ ...f, companyName: e.target.value }))}
                placeholder="Acme Corp"
                className="input"
                disabled={addSaving}
              />
            </div>
          </div>

          {addError && (
            <Banner variant="danger" size="sm">{addError}</Banner>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setAddOpen(false)} className="btn-secondary" disabled={addSaving}>
              Cancel
            </button>
            <button onClick={submitAdd} className="btn-primary" disabled={addSaving}>
              {addSaving ? 'Adding…' : 'Add contact'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Generate email modal */}
      <Modal
        open={!!generateTarget}
        onClose={closeGenerate}
        title={generateTarget ? `Generate email to ${getName(generateTarget) || getEmail(generateTarget) || 'contact'}` : 'Generate email'}
        size="lg"
      >
        <div className="space-y-4 px-4 py-4 sm:px-6">
          {/* Contact context */}
          {generateTarget && (
            <div className="rounded-xl border border-warm-200 bg-warm-50/60 px-4 py-3 text-xs text-muted">
              <div>
                <span className="font-semibold text-dark">{getName(generateTarget) || '—'}</span>
                {getTitle(generateTarget) ? ` · ${getTitle(generateTarget)}` : ''}
              </div>
              <div className="text-muted/80">{getCompany(generateTarget) || 'No company'} · {getEmail(generateTarget) || 'no email'}</div>
            </div>
          )}

          {/* Output — rendered first so it's immediately visible after generation */}
          {(draftFlow.subject || draftFlow.body || draftFlow.generating) && (
            <div className="space-y-3">
              <div>
                <label className="label">Subject</label>
                <input
                  value={draftFlow.subject}
                  onChange={e => draftFlow.setSubject(e.target.value)}
                  placeholder={draftFlow.generating ? 'Generating…' : ''}
                  className="input"
                  disabled={draftFlow.generating}
                />
              </div>
              <div>
                <label className="label">Body</label>
                <textarea
                  value={draftFlow.body}
                  onChange={e => draftFlow.setBody(e.target.value)}
                  placeholder={draftFlow.generating ? 'Generating…' : ''}
                  rows={9}
                  className="input text-sm leading-relaxed"
                  disabled={draftFlow.generating}
                />
              </div>
            </div>
          )}

          {/* Options — always visible; visually demoted once output exists */}
          <div className={`space-y-3${(draftFlow.subject || draftFlow.body || draftFlow.generating) ? ' border-t border-warm-200 pt-4' : ''}`}>
            {(draftFlow.subject || draftFlow.body || draftFlow.generating) && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/60">Customize</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Template (optional)</label>
                <select
                  value={generateTemplateId}
                  onChange={e => setGenerateTemplateId(e.target.value)}
                  className="select"
                  disabled={draftFlow.generating}
                >
                  <option value="">Generate from scratch</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Tone (optional)</label>
                <input
                  value={generateTone}
                  onChange={e => setGenerateTone(e.target.value)}
                  placeholder="e.g. curious, low-key, technical"
                  className="input"
                  disabled={draftFlow.generating}
                />
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-warm-200 bg-warm-50 px-4 py-3 text-sm text-dark">
              <input
                type="checkbox"
                checked={includeResumeBullet}
                onChange={e => setIncludeResumeBullet(e.target.checked)}
                disabled={draftFlow.generating}
                className="mt-1"
              />
              <span>
                <span className="font-medium">Include one resume detail</span>
                <span className="mt-1 block text-xs leading-5 text-muted">
                  Only used if it's genuinely relevant to this contact.
                </span>
              </span>
            </label>
            <button
              onClick={runGenerate}
              disabled={draftFlow.generating || !generateTarget}
              className="btn-primary w-full justify-center"
            >
              <Sparkles size={14} />
              {draftFlow.generating ? 'Generating…' : draftFlow.subject ? 'Regenerate' : 'Generate with Claude'}
            </button>
          </div>

          {draftFlow.error && (
            <Banner variant="danger" size="sm">{draftFlow.error}</Banner>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={closeGenerate} className="btn-secondary" disabled={draftFlow.saving}>
              Cancel
            </button>
            <button
              onClick={saveDraft}
              disabled={draftFlow.saving || draftFlow.generating || !draftFlow.subject || !draftFlow.body}
              className="btn-primary"
            >
              {draftFlow.saving ? 'Saving…' : 'Save as draft'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
