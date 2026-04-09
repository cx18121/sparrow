import React, { useState, useRef, useMemo } from 'react'
import {
  Upload, Search, Plus, Trash2, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, Filter, X, AlertTriangle, Download,
} from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import Papa from 'papaparse'
import Badge from '../ui/Badge'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'

const PAGE_SIZE = 10

const STATUSES = ['active', 'bounced', 'unsubscribed']
const FIRST_NAMES = ['Alex', 'Taylor', 'Jordan', 'Morgan', 'Casey', 'Avery', 'Cameron', 'Parker', 'Rowan', 'Skyler']
const LAST_NAMES = ['Chen', 'Patel', 'Rivera', 'Morgan', 'Brooks', 'Nguyen', 'Hughes', 'Lee', 'Diaz', 'Turner']
const COMPANY_PREFIXES = ['Northstar', 'Summit', 'Vector', 'Signal', 'Anchor', 'Atlas', 'Bluebird', 'Forge', 'Harbor', 'Lattice']
const COMPANY_SUFFIXES = ['Labs', 'Cloud', 'Systems', 'Works', 'AI', 'HQ', 'Analytics', 'Studio', 'Partners', 'Tech']

function ContactForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial || { firstName: '', lastName: '', email: '', company: '', status: 'active' })
  const field = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const valid = form.email && form.firstName

  return (
    <div className="px-6 py-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">First name *</label><input value={form.firstName} onChange={e => field('firstName', e.target.value)} className="input" placeholder="Jane" /></div>
        <div><label className="label">Last name</label><input value={form.lastName} onChange={e => field('lastName', e.target.value)} className="input" placeholder="Smith" /></div>
      </div>
      <div><label className="label">Email *</label><input type="email" value={form.email} onChange={e => field('email', e.target.value)} className="input" placeholder="jane@example.com" /></div>
      <div><label className="label">Company</label><input value={form.company} onChange={e => field('company', e.target.value)} className="input" placeholder="Acme Corp" /></div>
      <div>
        <label className="label">Status</label>
        <select value={form.status} onChange={e => field('status', e.target.value)} className="select">
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={() => { if (valid) onSave(form) }} disabled={!valid} className="btn-primary">Save</button>
      </div>
    </div>
  )
}

function CSVImportModal({ onImport, onClose }) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const handleFile = (file) => {
    if (!file) return
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data, errors }) => {
        if (errors.length) { setError('CSV parse error: ' + errors[0].message); return }
        const mapped = data.map(row => ({
          id: uuidv4(),
          firstName: row.first_name || row.firstName || row.First_Name || row['First Name'] || '',
          lastName: row.last_name || row.lastName || row.Last_Name || row['Last Name'] || '',
          email: row.email || row.Email || '',
          company: row.company || row.Company || '',
          status: 'active',
          createdAt: new Date().toISOString(),
        })).filter(r => r.email)
        setRows(mapped)
        setError('')
      },
    })
  }

  return (
    <div className="px-6 py-4 space-y-4">
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
      >
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />
        <Upload size={24} className="mx-auto text-muted mb-2" />
        <p className="text-sm font-medium text-dark">Drop CSV file here or click to browse</p>
        <p className="text-xs text-muted mt-1">Expected columns: first_name, last_name, email, company</p>
      </div>

      {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={12} />{error}</p>}

      {rows.length > 0 && (
        <div>
          <p className="text-sm font-medium text-dark mb-2">{rows.length} contacts ready to import</p>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-100">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-muted font-medium">Name</th>
                  <th className="px-3 py-2 text-left text-muted font-medium">Email</th>
                  <th className="px-3 py-2 text-left text-muted font-medium">Company</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.slice(0, 20).map(r => (
                  <tr key={r.id}>
                    <td className="px-3 py-1.5 text-dark">{r.firstName} {r.lastName}</td>
                    <td className="px-3 py-1.5 text-muted">{r.email}</td>
                    <td className="px-3 py-1.5 text-muted">{r.company || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 20 && <p className="text-xs text-muted mt-1">…and {rows.length - 20} more</p>}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={() => { onImport(rows); onClose() }} disabled={rows.length === 0} className="btn-primary">
          Import {rows.length > 0 ? `${rows.length} contacts` : ''}
        </button>
      </div>
    </div>
  )
}

function SegmentBuilder({ contacts, segments, setSegments, onClose }) {
  const [name, setName] = useState('')
  const [filters, setFilters] = useState([{ id: uuidv4(), field: 'company', operator: 'equals', value: '' }])

  const fields = ['company', 'status', 'email']
  const operators = ['equals', 'contains', 'not equals']

  const addFilter = () => setFilters(f => [...f, { id: uuidv4(), field: 'company', operator: 'equals', value: '' }])
  const removeFilter = (id) => setFilters(f => f.filter(x => x.id !== id))
  const updateFilter = (id, key, val) => setFilters(f => f.map(x => x.id === id ? { ...x, [key]: val } : x))

  const matchedCount = useMemo(() => {
    return contacts.filter(c => filters.every(f => {
      const cv = (c[f.field] || '').toString().toLowerCase()
      const fv = f.value.toLowerCase()
      if (f.operator === 'equals') return cv === fv
      if (f.operator === 'contains') return cv.includes(fv)
      if (f.operator === 'not equals') return cv !== fv
      return true
    })).length
  }, [contacts, filters])

  const save = () => {
    if (!name) return
    setSegments(prev => [...prev, { id: uuidv4(), name, filters, count: matchedCount, createdAt: new Date().toISOString() }])
    onClose()
  }

  return (
    <div className="px-6 py-4 space-y-4">
      <div><label className="label">Segment name *</label><input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="e.g. Acme Actives" /></div>

      <div className="space-y-2">
        <label className="label">Filters (AND logic)</label>
        {filters.map((f, i) => (
          <div key={f.id} className="flex items-center gap-2">
            {i > 0 && <span className="text-xs text-muted w-8 text-right">AND</span>}
            {i === 0 && <span className="text-xs text-muted w-8 text-right">Where</span>}
            <select value={f.field} onChange={e => updateFilter(f.id, 'field', e.target.value)} className="select flex-1 text-xs py-1.5">
              {fields.map(fd => <option key={fd} value={fd}>{fd}</option>)}
            </select>
            <select value={f.operator} onChange={e => updateFilter(f.id, 'operator', e.target.value)} className="select flex-1 text-xs py-1.5">
              {operators.map(op => <option key={op} value={op}>{op}</option>)}
            </select>
            <input value={f.value} onChange={e => updateFilter(f.id, 'value', e.target.value)} className="input flex-1 text-xs py-1.5" placeholder="Value…" />
            {filters.length > 1 && <button onClick={() => removeFilter(f.id)} className="text-muted hover:text-red-500"><X size={13} /></button>}
          </div>
        ))}
        <button onClick={addFilter} className="btn-ghost text-xs"><Plus size={11} /> Add filter</button>
      </div>

      <div className="p-3 bg-primary/5 rounded-lg text-sm text-primary font-medium">
        {matchedCount} contacts match this segment
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={!name} className="btn-primary">Save segment</button>
      </div>
    </div>
  )
}

export default function ContactsTab({ contacts, setContacts, workspaceConfig }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState('firstName')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(1)
  const [tab, setTab] = useState('contacts') // 'contacts' | 'segments' | 'blacklist'
  const [csvModal, setCsvModal] = useState(false)
  const [contactModal, setContactModal] = useState(false)
  const [editingContact, setEditingContact] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [segments, setSegments] = useState([])
  const [segmentModal, setSegmentModal] = useState(false)
  const [blacklist, setBlacklist] = useState([])
  const [blacklistInput, setBlacklistInput] = useState('')
  const leadTarget = Math.max(1, workspaceConfig?.leadsPerGeneration || 50)
  const profileSummary = workspaceConfig?.resumeText?.trim()
    ? workspaceConfig.resumeText.trim().slice(0, 140)
    : workspaceConfig?.resumeFileName
      ? `Profile loaded from ${workspaceConfig.resumeFileName}`
      : 'No AI profile context saved yet.'
  const activeCount = contacts.filter(contact => contact.status === 'active').length
  const segmentCount = segments.length
  const blacklistedCount = blacklist.length

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <ChevronUp size={11} className="text-gray-300" />
    return sortDir === 'asc' ? <ChevronUp size={11} className="text-primary" /> : <ChevronDown size={11} className="text-primary" />
  }

  const filtered = useMemo(() => {
    let data = contacts
    if (search) data = data.filter(c =>
      `${c.firstName} ${c.lastName} ${c.email} ${c.company}`.toLowerCase().includes(search.toLowerCase())
    )
    if (statusFilter !== 'all') data = data.filter(c => c.status === statusFilter)
    data = [...data].sort((a, b) => {
      let av = (a[sortKey] || '').toLowerCase()
      let bv = (b[sortKey] || '').toLowerCase()
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return data
  }, [contacts, search, statusFilter, sortKey, sortDir])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const saveContact = (form) => {
    const now = new Date().toISOString()
    if (editingContact) {
      setContacts(prev => prev.map(c => c.id === editingContact ? { ...c, ...form, updatedAt: now } : c))
    } else {
      setContacts(prev => [...prev, { id: uuidv4(), ...form, createdAt: now }])
    }
    setContactModal(false)
    setEditingContact(null)
  }

  const openEdit = (c) => { setEditingContact(c.id); setContactModal(true) }
  const importContacts = (rows) => setContacts(prev => [...prev, ...rows])
  const generateLeads = () => {
    const stamp = Date.now()
    const generated = Array.from({ length: leadTarget }, (_, index) => {
      const firstName = FIRST_NAMES[index % FIRST_NAMES.length]
      const lastName = LAST_NAMES[(index + 3) % LAST_NAMES.length]
      const company = `${COMPANY_PREFIXES[(index + 2) % COMPANY_PREFIXES.length]} ${COMPANY_SUFFIXES[(index + 4) % COMPANY_SUFFIXES.length]}`
      const domain = company.toLowerCase().replace(/[^a-z0-9]+/g, '')

      return {
        id: uuidv4(),
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${stamp + index}@${domain}.com`,
        company,
        status: 'active',
        createdAt: new Date().toISOString(),
      }
    })

    setContacts(prev => [...generated, ...prev])
  }
  const addToBlacklist = () => {
    if (blacklistInput.trim()) { setBlacklist(prev => [...prev, blacklistInput.trim()]); setBlacklistInput('') }
  }

  const exportCSV = () => {
    const csv = Papa.unparse(filtered.map(c => ({
      first_name: c.firstName, last_name: c.lastName, email: c.email, company: c.company, status: c.status,
    })))
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'contacts.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page-shell">
      <div className="flex flex-wrap items-center justify-between gap-3 py-2">
        <div className="segmented-control">
          {[['contacts', 'Contacts'], ['segments', 'Segments'], ['blacklist', 'Blacklist']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`segmented-chip ${tab === id ? 'segmented-chip-active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportCSV} className="btn-secondary text-xs"><Download size={13} /> Export</button>
          <button onClick={generateLeads} className="btn-secondary text-xs">Generate {leadTarget}</button>
          <button onClick={() => setCsvModal(true)} className="btn-secondary text-xs"><Upload size={13} /> Import CSV</button>
          <button onClick={() => { setEditingContact(null); setContactModal(true) }} className="btn-primary text-xs"><Plus size={13} /> Add contact</button>
        </div>
      </div>

      {tab === 'contacts' && (
        <>
          <div className="page-toolbar">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Lead Generation</p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-medium text-dark">
                  Generate {leadTarget} leads per run
                  {workspaceConfig?.senderName ? ` for ${workspaceConfig.senderName}` : ''}
                </p>
                {(workspaceConfig?.senderRole || workspaceConfig?.senderCompany) && (
                  <p className="mt-1 text-xs text-muted">
                    {workspaceConfig?.senderRole || 'Outbound profile'}
                    {workspaceConfig?.senderCompany ? ` at ${workspaceConfig.senderCompany}` : ''}
                  </p>
                )}
                <p className="mt-1 text-sm leading-6 text-muted">
                  {profileSummary}
                  {workspaceConfig?.resumeText?.trim()?.length > 140 ? '…' : ''}
                </p>
              </div>
              <button onClick={generateLeads} className="btn-primary whitespace-nowrap text-xs py-1.5">
                Generate now
              </button>
            </div>
          </div>

          <div className="page-toolbar">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1 max-w-sm">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search contacts, domains, or companies…" className="input pl-9" />
                </div>
                <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} className="select w-full sm:w-44">
                  <option value="all">All statuses</option>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <p className="text-sm text-muted">
                {filtered.length} visible contact{filtered.length !== 1 ? 's' : ''} across {totalPages || 1} page{(totalPages || 1) !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="table-shell">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-[rgba(248,250,252,0.86)]">
                  {[['firstName', 'Name'], ['email', 'Email'], ['company', 'Company'], ['status', 'Status']].map(([key, label]) => (
                    <th key={key} className="px-5 py-4 text-left">
                      <button onClick={() => toggleSort(key)} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80 transition-colors hover:text-dark">
                        {label} <SortIcon col={key} />
                      </button>
                    </th>
                  ))}
                  <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginated.map(c => (
                  <tr key={c.id} className="transition-colors hover:bg-[rgba(248,250,252,0.72)]">
                    <td className="px-5 py-4 font-medium text-dark">{c.firstName} {c.lastName}</td>
                    <td className="px-5 py-4 text-muted">{c.email}</td>
                    <td className="px-5 py-4 text-muted">{c.company || '—'}</td>
                    <td className="px-5 py-4"><Badge variant={c.status}>{c.status}</Badge></td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => openEdit(c)} className="btn-ghost px-2 py-1"><Filter size={12} /></button>
                        <button onClick={() => setDeleteTarget(c.id)} className="btn-ghost px-2 py-1 hover:text-red-500"><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {paginated.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10"><div className="empty-state border-0 bg-transparent py-10 shadow-none">No contacts found.</div></td></tr>
                )}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4">
                <p className="text-xs text-muted">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-ghost px-2 py-1 disabled:opacity-40"><ChevronLeft size={13} /></button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i
                    return (
                      <button key={p} onClick={() => setPage(p)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${p === page ? 'bg-primary text-white shadow-[0_10px_24px_rgba(27,110,243,0.2)]' : 'text-muted hover:bg-white hover:text-dark'}`}>{p}</button>
                    )
                  })}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-ghost px-2 py-1 disabled:opacity-40"><ChevronRight size={13} /></button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'segments' && (
        <div className="space-y-4">
          <div className="page-toolbar flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-dark">Saved audience slices</p>
              <p className="mt-1 text-sm text-muted">Group contacts by rules so campaigns can target them without rebuilding filters.</p>
            </div>
            <button onClick={() => setSegmentModal(true)} className="btn-primary text-xs"><Plus size={13} /> New segment</button>
          </div>
          {segments.length === 0 ? (
            <div className="empty-state">No segments yet. Create one with filters to group your contacts.</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {segments.map(seg => (
                <div key={seg.id} className="card p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-dark text-sm">{seg.name}</p>
                      <p className="text-xs text-muted mt-0.5">{seg.count} contacts</p>
                    </div>
                    <button onClick={() => setSegments(prev => prev.filter(s => s.id !== seg.id))} className="text-muted hover:text-red-500"><Trash2 size={13} /></button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {seg.filters.map((f, i) => (
                      <span key={i} className="text-xs bg-gray-100 text-muted rounded px-2 py-0.5">{f.field} {f.operator} "{f.value}"</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'blacklist' && (
        <div className="max-w-2xl space-y-4">
          <div className="page-toolbar">
            <p className="text-sm text-muted mb-4">Emails on the blacklist will be excluded from all campaigns.</p>
            <div className="flex gap-2">
              <input value={blacklistInput} onChange={e => setBlacklistInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addToBlacklist()} placeholder="email@domain.com" className="input flex-1" />
              <button onClick={addToBlacklist} className="btn-primary">Add</button>
            </div>
          </div>
          {blacklist.length === 0 ? (
            <div className="empty-state py-10">No blacklisted emails.</div>
          ) : (
            <div className="table-shell divide-y divide-slate-100">
              {blacklist.map((email, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-dark">{email}</span>
                  <button onClick={() => setBlacklist(prev => prev.filter((_, j) => j !== i))} className="btn-ghost px-2 py-1 hover:text-red-500"><X size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <Modal open={csvModal} onClose={() => setCsvModal(false)} title="Import contacts from CSV" size="lg">
        <CSVImportModal onImport={importContacts} onClose={() => setCsvModal(false)} />
      </Modal>

      <Modal open={contactModal} onClose={() => { setContactModal(false); setEditingContact(null) }} title={editingContact ? 'Edit contact' : 'Add contact'} size="sm">
        <ContactForm
          initial={editingContact ? contacts.find(c => c.id === editingContact) : null}
          onSave={saveContact}
          onClose={() => { setContactModal(false); setEditingContact(null) }}
        />
      </Modal>

      <Modal open={segmentModal} onClose={() => setSegmentModal(false)} title="New segment" size="lg">
        <SegmentBuilder contacts={contacts} segments={segments} setSegments={setSegments} onClose={() => setSegmentModal(false)} />
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { setContacts(prev => prev.filter(c => c.id !== deleteTarget)); setDeleteTarget(null) }}
        title="Delete contact"
        message="Remove this contact? This action cannot be undone."
      />
    </div>
  )
}
