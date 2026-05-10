import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Mail, PenLine, Plus, Send, Users, Trash2, X } from 'lucide-react'
import Banner from '../ui/Banner'
import Pill from '../ui/Pill'
import {
  createCustomContact,
  generateEmail,
  removeCampaignCustomContact,
  removeCampaignLead,
  type CampaignMembers,
} from '../../lib/api'
import { actionKey, createIdempotencyKey, runExclusive } from '../../lib/pendingActions'
import { useCampaignMembers } from '../../hooks/useCampaignWorkspaceData'
import type { EmailStatus, UserLead } from '../../types/api'

interface ContactsTabProps {
  campaignId: string
  templateId?: string | null
  attachmentIds?: string[]
  tone?: string | null
  onJumpToDrafts?: () => void
  onJumpToLeads?: () => void
}

type DraftPillStatus = 'no-draft' | 'draft' | 'sent'
type CustomMember = CampaignMembers['customContacts'][number]

interface Row {
  selectionId: string                  // 'lead:<id>' or 'cc:<id>'
  rowKind: 'lead' | 'custom-contact'
  rowId: string                        // campaignLeadId or campaignCustomContactId
  name: string
  title: string | null
  email: string | null
  companyName: string | null
  hasEmail: boolean
  draftStatus: DraftPillStatus
  generateArgs: { userLeadId?: string; customContactId?: string }
}

function emailsToStatus(emails: ReadonlyArray<{ status: EmailStatus | string }> | undefined): DraftPillStatus {
  if (!emails) return 'no-draft'
  if (emails.some(e => e.status === 'sent')) return 'sent'
  if (emails.some(e => e.status === 'draft')) return 'draft'
  return 'no-draft'
}

function leadToRow(lead: UserLead): Row {
  return {
    selectionId: `lead:${lead.id}`,
    rowKind: 'lead',
    rowId: lead.campaignLeadId ?? lead.id,
    name: lead.contact?.name ?? 'Unknown',
    title: lead.contact?.title ?? null,
    email: lead.contact?.email ?? null,
    companyName: lead.company?.name ?? null,
    hasEmail: Boolean(lead.contact?.email),
    draftStatus: emailsToStatus(lead.emails),
    generateArgs: { userLeadId: lead.id },
  }
}

function customToRow(cc: CustomMember): Row {
  return {
    selectionId: `cc:${cc.id}`,
    rowKind: 'custom-contact',
    rowId: cc.campaignCustomContactId,
    name: cc.name || cc.email || 'Unnamed contact',
    title: cc.title ?? null,
    email: cc.email ?? null,
    companyName: cc.companyName ?? null,
    hasEmail: Boolean(cc.email),
    draftStatus: emailsToStatus(cc.emails),
    generateArgs: { customContactId: cc.id },
  }
}

function StatusPill({ status }: { status: DraftPillStatus }) {
  if (status === 'sent') {
    return (
      <Pill variant="success" icon={Send} className="text-xs font-medium">
        Sent
      </Pill>
    )
  }
  if (status === 'draft') {
    return (
      <Pill variant="info" icon={PenLine} className="text-xs font-medium">
        Draft ready
      </Pill>
    )
  }
  return (
    <Pill variant="neutral" className="text-xs font-medium">
      No draft
    </Pill>
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface AddFormProps {
  busy: boolean
  onCancel: () => void
  onSubmit: (data: { name: string; email: string; title: string; companyName: string }) => void
}

function AddContactForm({ busy, onCancel, onSubmit }: AddFormProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')

  const canSubmit =
    !busy &&
    (name.trim().length > 0 || email.trim().length > 0) &&
    (email.trim().length === 0 || EMAIL_RE.test(email.trim()))

  return (
    <form
      className="surface-panel p-4 grid gap-3 sm:grid-cols-2"
      onSubmit={e => {
        e.preventDefault()
        if (!canSubmit) return
        onSubmit({ name: name.trim(), email: email.trim(), title: title.trim(), companyName: company.trim() })
      }}
    >
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-muted">Name</span>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          disabled={busy}
          className="rounded-md border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-dark focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-muted">Email</span>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={busy}
          className="rounded-md border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-dark focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-muted">Title</span>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          disabled={busy}
          className="rounded-md border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-dark focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-muted">Company</span>
        <input
          value={company}
          onChange={e => setCompany(e.target.value)}
          disabled={busy}
          className="rounded-md border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-dark focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
      </label>
      <div className="sm:col-span-2 flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-xs font-medium text-muted hover:text-dark disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary inline-flex items-center gap-1.5 text-xs py-1 px-2.5 disabled:opacity-50"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          {busy ? 'Adding…' : 'Add to campaign'}
        </button>
      </div>
    </form>
  )
}

export default function ContactsTab({ campaignId, templateId, attachmentIds, tone, onJumpToDrafts, onJumpToLeads }: ContactsTabProps) {
  // Campaign-scoped generation must carry the campaign's template (so verbatim
  // mode and the user's authored body actually drive the draft) plus its
  // attachment list and tone — without these, the server falls into kind:'ai'
  // and the humanizer rewrites everything regardless of the template's
  // verbatim flag.
  const generateOverrides = {
    ...(templateId ? { templateId } : {}),
    ...(attachmentIds && attachmentIds.length ? { attachmentIds } : {}),
    ...(tone ? { tone } : {}),
  }
  const [leads, setLeads] = useState<UserLead[] | null>(null)
  const [customContacts, setCustomContacts] = useState<CustomMember[]>([])
  const [error, setError] = useState<string | null>(null)
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set())
  const generatingIdsRef = useRef<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<{ kind: 'generate' | 'remove'; done: number; total: number } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const addingRef = useRef(false)
  const members = useCampaignMembers(campaignId)

  useEffect(() => {
    if (members.data) {
      setLeads(members.data.items ?? [])
      setCustomContacts(members.data.customContacts ?? [])
      setError(members.error?.message || null)
    } else if (members.isLoading) {
      setLeads(null)
      setCustomContacts([])
    }
  }, [members.data, members.error, members.isLoading])

  const rows = useMemo<Row[]>(() => {
    const leadRows = (leads ?? []).map(leadToRow)
    const customRows = customContacts.map(customToRow)
    // Manually-added contacts float to the top so the user sees what they
    // just added without scrolling past dozens of Apollo leads.
    return [...customRows, ...leadRows]
  }, [leads, customContacts])

  useEffect(() => {
    if (leads === null) return
    setSelectedIds(prev => {
      const stillThere = new Set(rows.map(r => r.selectionId))
      const next = new Set<string>()
      for (const id of prev) if (stillThere.has(id)) next.add(id)
      return next.size === prev.size ? prev : next
    })
  }, [leads, rows])

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.selectionId))
  const someSelected = !allSelected && selectedIds.size > 0

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(rows.map(r => r.selectionId)))
  }

  const selectedRows = useMemo(
    () => rows.filter(r => selectedIds.has(r.selectionId)),
    [rows, selectedIds]
  )
  const selectedNoDraftRows = useMemo(
    () => selectedRows.filter(r => r.draftStatus === 'no-draft' && r.hasEmail && !generatingIds.has(r.selectionId)),
    [generatingIds, selectedRows]
  )

  const handleAddSubmit = async (data: { name: string; email: string; title: string; companyName: string }) => {
    if (addingRef.current) return
    addingRef.current = true
    setAdding(true)
    const tempId = `temp-${Date.now()}`
    const optimisticContact: CustomMember = {
      id: tempId,
      userId: '',
      name: data.name || null,
      email: data.email || null,
      title: data.title || null,
      companyName: data.companyName || null,
      status: 'SAVED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      campaignCustomContactId: tempId,
      emails: [],
    }
    const previousLeads = leads ?? []
    const previousCustomContacts = customContacts
    setCustomContacts(prev => [optimisticContact, ...prev])
    members.mutate(
      { items: previousLeads, customContacts: [optimisticContact, ...previousCustomContacts] },
      { revalidate: false },
    )
    try {
      const created = await runExclusive(actionKey('custom-contact-create', campaignId, data.email || data.name), () => createCustomContact({
        name: data.name || null,
        email: data.email || null,
        title: data.title || null,
        companyName: data.companyName || null,
        campaignId,
      }))
      const hydrated = { ...created, campaignCustomContactId: created.campaignCustomContactId ?? tempId, emails: [] } as CustomMember
      setCustomContacts(prev => [hydrated, ...prev.filter(c => c.id !== tempId)])
      members.mutate(
        { items: leads ?? [], customContacts: [hydrated, ...customContacts.filter(c => c.id !== tempId)] },
        { revalidate: false },
      )
      setAddOpen(false)
      void members.mutate()
    } catch (err) {
      setCustomContacts(previousCustomContacts)
      members.mutate({ items: previousLeads, customContacts: previousCustomContacts }, { revalidate: false })
      setError((err as Error)?.message || 'Could not add contact.')
    } finally {
      addingRef.current = false
      setAdding(false)
    }
  }

  const handleGenerate = async (row: Row) => {
    if (generatingIdsRef.current.has(row.selectionId)) return
    generatingIdsRef.current = new Set(generatingIdsRef.current).add(row.selectionId)
    setGeneratingIds(prev => new Set(prev).add(row.selectionId))
    try {
      const key = actionKey('draft-save', row.rowKind, row.generateArgs.userLeadId ?? row.generateArgs.customContactId)
      const result = await runExclusive(key, () => generateEmail({ ...row.generateArgs, ...generateOverrides, save: true }, createIdempotencyKey(key)))
      const email = { id: result.emailId ?? `draft-${row.selectionId}`, subject: result.subject ?? null, status: 'draft' as const }
      if (row.rowKind === 'lead' && row.generateArgs.userLeadId) {
        setLeads(prev => (prev ?? []).map(lead => lead.id === row.generateArgs.userLeadId
          ? { ...lead, emails: [email, ...(lead.emails ?? []).filter(e => e.status !== 'draft')] }
          : lead
        ))
      } else if (row.generateArgs.customContactId) {
        setCustomContacts(prev => prev.map(contact => contact.id === row.generateArgs.customContactId
          ? { ...contact, emails: [email, ...(contact.emails ?? []).filter(e => e.status !== 'draft')] }
          : contact
        ))
      }
      void members.mutate()
    } catch (err) {
      setError((err as Error)?.message || 'Draft generation failed.')
    } finally {
      setGeneratingIds(prev => {
        const next = new Set(prev)
        next.delete(row.selectionId)
        generatingIdsRef.current = next
        return next
      })
    }
  }

  const handleBulkGenerate = async () => {
    const targets = selectedNoDraftRows
    if (targets.length === 0) return
    setBulkAction({ kind: 'generate', done: 0, total: targets.length })
    let succeeded = 0
    for (const row of targets) {
      try {
        const key = actionKey('draft-save', row.rowKind, row.generateArgs.userLeadId ?? row.generateArgs.customContactId)
        const result = await runExclusive(key, () => generateEmail({ ...row.generateArgs, ...generateOverrides, save: true }, createIdempotencyKey(key)))
        const email = { id: result.emailId ?? `draft-${row.selectionId}`, subject: result.subject ?? null, status: 'draft' as const }
        if (row.rowKind === 'lead' && row.generateArgs.userLeadId) {
          setLeads(prev => (prev ?? []).map(lead => lead.id === row.generateArgs.userLeadId
            ? { ...lead, emails: [email, ...(lead.emails ?? []).filter(e => e.status !== 'draft')] }
            : lead
          ))
        } else if (row.generateArgs.customContactId) {
          setCustomContacts(prev => prev.map(contact => contact.id === row.generateArgs.customContactId
            ? { ...contact, emails: [email, ...(contact.emails ?? []).filter(e => e.status !== 'draft')] }
            : contact
          ))
        }
        succeeded++
      } catch {
        // Continue on failure; the partial-success count surfaces in the toast.
      }
      setBulkAction(prev => (prev ? { ...prev, done: prev.done + 1 } : prev))
    }
    setBulkAction(null)
    setSelectedIds(new Set())
    void members.mutate()
    if (succeeded < targets.length) {
      setError(`${succeeded} of ${targets.length} drafts generated. The rest failed — try again.`)
    }
  }

  const handleBulkRemove = async () => {
    const targets = selectedRows
    if (targets.length === 0) return
    if (!window.confirm(`Remove ${targets.length} contact${targets.length === 1 ? '' : 's'} from this campaign?`)) return
    const previousLeads = leads ?? []
    const previousCustomContacts = customContacts
    const targetIds = new Set(targets.map(row => row.selectionId))
    const optimisticLeads = previousLeads.filter(lead => !targetIds.has(`lead:${lead.id}`))
    const optimisticCustomContacts = previousCustomContacts.filter(contact => !targetIds.has(`cc:${contact.id}`))
    setLeads(optimisticLeads)
    setCustomContacts(optimisticCustomContacts)
    members.mutate({ items: optimisticLeads, customContacts: optimisticCustomContacts }, { revalidate: false })
    setBulkAction({ kind: 'remove', done: 0, total: targets.length })
    let failed = false
    for (const row of targets) {
      try {
        if (row.rowKind === 'lead') {
          await removeCampaignLead(row.rowId)
        } else {
          await removeCampaignCustomContact(row.rowId)
        }
      } catch {
        failed = true
        // Ignore individual failures — they'll just stay in the list.
      }
      setBulkAction(prev => (prev ? { ...prev, done: prev.done + 1 } : prev))
    }
    setBulkAction(null)
    setSelectedIds(new Set())
    if (failed) {
      setLeads(previousLeads)
      setCustomContacts(previousCustomContacts)
      members.mutate({ items: previousLeads, customContacts: previousCustomContacts }, { revalidate: false })
    }
    void members.mutate()
  }

  if (leads === null && !error) {
    return (
      <div className="surface-panel flex items-center gap-2 px-6 py-7 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" /> Loading saved contacts…
      </div>
    )
  }

  if (error && rows.length === 0 && !addOpen) {
    return <Banner variant="warning" size="sm">{error}</Banner>
  }

  const bulkBusy = bulkAction !== null
  const isEmpty = rows.length === 0

  return (
    <div className="space-y-3">
      {error && <Banner variant="warning" size="sm">{error}</Banner>}

      <div className="flex items-center justify-between">
        <div>
          {!isEmpty && (
            <button
              type="button"
              onClick={toggleAll}
              className="btn-ghost text-xs text-muted hover:text-dark"
            >
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
          )}
        </div>
        <div>
          {!addOpen && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="btn-secondary inline-flex items-center gap-1.5 text-xs py-1 px-2.5"
            >
              <Plus size={11} /> Add contact
            </button>
          )}
          {addOpen && (
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="text-xs font-medium text-muted hover:text-dark inline-flex items-center gap-1"
            >
              <X size={11} /> Close
            </button>
          )}
        </div>
      </div>

      {addOpen && (
        <AddContactForm
          busy={adding}
          onCancel={() => setAddOpen(false)}
          onSubmit={handleAddSubmit}
        />
      )}

      {isEmpty && !addOpen && (
        <div className="surface-panel px-6 py-12 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Users size={18} />
          </div>
          <h2 className="mt-3 font-display text-lg font-semibold text-dark">No saved contacts yet</h2>
          <p className="mt-1.5 text-sm text-muted">
            Save contacts from the Leads tab, or add one manually with the button above.
          </p>
          {onJumpToLeads && (
            <button onClick={onJumpToLeads} className="btn-primary mt-4 text-xs">
              Find leads
            </button>
          )}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="surface-panel flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <span className="text-sm font-medium text-dark">
            {bulkAction
              ? `${bulkAction.kind === 'generate' ? 'Generating' : 'Removing'} ${bulkAction.done} / ${bulkAction.total}…`
              : `${selectedIds.size} selected`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBulkGenerate}
              disabled={bulkBusy || selectedNoDraftRows.length === 0}
              className="btn-primary inline-flex items-center gap-1.5 text-xs py-1 px-2.5 disabled:opacity-50"
              title={selectedNoDraftRows.length === 0 ? 'No selected contacts need a draft' : `Generate ${selectedNoDraftRows.length} draft${selectedNoDraftRows.length === 1 ? '' : 's'}`}
            >
              {bulkAction?.kind === 'generate' ? <Loader2 size={11} className="animate-spin" /> : <PenLine size={11} />}
              Generate {selectedNoDraftRows.length > 0 ? `(${selectedNoDraftRows.length})` : ''}
            </button>
            <button
              type="button"
              onClick={handleBulkRemove}
              disabled={bulkBusy}
              className="inline-flex items-center gap-1.5 rounded-md border border-warm-200 px-2.5 py-1 text-xs font-medium text-dark hover:bg-warm-50 disabled:opacity-50"
            >
              {bulkAction?.kind === 'remove' ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              Remove
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkBusy}
              className="text-xs font-medium text-muted hover:text-dark disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {!isEmpty && (
        <div className="surface-panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-warm-200 bg-warm-50/60 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted/80">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={Boolean(allSelected)}
                    ref={el => { if (el) el.indeterminate = Boolean(someSelected) }}
                    onChange={toggleAll}
                    className="cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Company</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-200/80">
              {rows.map(row => {
                const generating = generatingIds.has(row.selectionId)
                const checked = selectedIds.has(row.selectionId)
                return (
                  <tr key={row.selectionId} className={`transition-colors hover:bg-warm-50/60 ${checked ? 'bg-warm-50/40' : ''}`}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.name}`}
                        checked={checked}
                        onChange={() => toggleOne(row.selectionId)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-dark">{row.name}</span>
                        {row.rowKind === 'custom-contact' && (
                          <span className="rounded-full bg-warm-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                            Manual
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted">{row.title ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted max-w-[200px]">
                      {row.email
                        ? <span className="font-mono truncate block">{row.email}</span>
                        : <span className="italic text-muted/60">No email</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-sm text-dark">{row.companyName ?? '—'}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={row.draftStatus} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.draftStatus === 'no-draft' ? (
                        <button
                          type="button"
                          onClick={() => handleGenerate(row)}
                          disabled={generating || bulkBusy || !row.hasEmail}
                          className="btn-primary inline-flex items-center gap-1.5 text-xs py-1 px-2.5 disabled:opacity-50"
                          title={!row.hasEmail ? 'Add an email address to this contact first' : undefined}
                        >
                          {generating ? <Loader2 size={11} className="animate-spin" /> : <PenLine size={11} />}
                          {generating ? 'Generating…' : 'Generate draft'}
                        </button>
                      ) : onJumpToDrafts ? (
                        <button
                          type="button"
                          onClick={onJumpToDrafts}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                        >
                          <Mail size={11} /> Open in Drafts
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
