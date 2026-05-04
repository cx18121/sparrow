import { useEffect, useMemo, useState, useCallback } from 'react'
import { Loader2, Mail, PenLine, Send, Users, Trash2 } from 'lucide-react'
import Banner from '../ui/Banner'
import { fetchCampaignLeads, generateEmail, removeCampaignLead } from '../../lib/api'
import type { UserLead } from '../../types/api'

interface ContactsTabProps {
  campaignId: string
  onJumpToDrafts?: () => void
  onJumpToLeads?: () => void
}

type LeadStatus = 'no-draft' | 'draft' | 'sent'

function leadStatus(lead: UserLead): LeadStatus {
  const emails = lead.emails ?? []
  if (emails.some(e => e.status === 'sent')) return 'sent'
  if (emails.some(e => e.status === 'draft')) return 'draft'
  return 'no-draft'
}

function StatusPill({ status }: { status: LeadStatus }) {
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <Send size={11} /> Sent
      </span>
    )
  }
  if (status === 'draft') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
        <PenLine size={11} /> Draft ready
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warm-100 px-2 py-0.5 text-xs font-medium text-muted">
      No draft
    </span>
  )
}

export default function ContactsTab({ campaignId, onJumpToDrafts, onJumpToLeads }: ContactsTabProps) {
  const [leads, setLeads] = useState<UserLead[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<{ kind: 'generate' | 'remove'; done: number; total: number } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetchCampaignLeads(campaignId)
      setLeads(res?.items ?? [])
      setError(null)
    } catch (err) {
      setError((err as Error)?.message || 'Could not load saved contacts.')
    }
  }, [campaignId])

  useEffect(() => { load() }, [load])

  // Drop selections that no longer exist (e.g. after a bulk remove).
  useEffect(() => {
    if (!leads) return
    setSelectedIds(prev => {
      const stillThere = new Set(leads.map(l => l.id))
      const next = new Set<string>()
      for (const id of prev) if (stillThere.has(id)) next.add(id)
      return next.size === prev.size ? prev : next
    })
  }, [leads])

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = leads && leads.length > 0 && leads.every(l => selectedIds.has(l.id))
  const someSelected = !allSelected && selectedIds.size > 0

  const toggleAll = () => {
    if (!leads) return
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(leads.map(l => l.id)))
  }

  const selectedLeads = useMemo(
    () => (leads ?? []).filter(l => selectedIds.has(l.id)),
    [leads, selectedIds]
  )
  const selectedNoDraftLeads = useMemo(
    () => selectedLeads.filter(l => leadStatus(l) === 'no-draft' && l.contact),
    [selectedLeads]
  )

  const handleGenerate = async (lead: UserLead) => {
    setGeneratingId(lead.id)
    try {
      await generateEmail({ userLeadId: lead.id, save: true })
      await load()
    } catch (err) {
      setError((err as Error)?.message || 'Draft generation failed.')
    } finally {
      setGeneratingId(null)
    }
  }

  const handleBulkGenerate = async () => {
    const targets = selectedNoDraftLeads
    if (targets.length === 0) return
    setBulkAction({ kind: 'generate', done: 0, total: targets.length })
    let succeeded = 0
    for (const lead of targets) {
      try {
        await generateEmail({ userLeadId: lead.id, save: true })
        succeeded++
      } catch {
        // Continue on failure; the partial-success count surfaces in the toast.
      }
      setBulkAction(prev => (prev ? { ...prev, done: prev.done + 1 } : prev))
    }
    setBulkAction(null)
    setSelectedIds(new Set())
    await load()
    if (succeeded < targets.length) {
      setError(`${succeeded} of ${targets.length} drafts generated. The rest failed — try again.`)
    }
  }

  const handleBulkRemove = async () => {
    const targets = selectedLeads.filter(l => l.campaignLeadId)
    if (targets.length === 0) return
    if (!window.confirm(`Remove ${targets.length} contact${targets.length === 1 ? '' : 's'} from this campaign?`)) return
    setBulkAction({ kind: 'remove', done: 0, total: targets.length })
    for (const lead of targets) {
      try {
        await removeCampaignLead(lead.campaignLeadId!)
      } catch {
        // Ignore individual failures — they'll just stay in the list.
      }
      setBulkAction(prev => (prev ? { ...prev, done: prev.done + 1 } : prev))
    }
    setBulkAction(null)
    setSelectedIds(new Set())
    await load()
  }

  if (leads === null && !error) {
    return (
      <div className="surface-panel flex items-center gap-2 px-6 py-7 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" /> Loading saved contacts…
      </div>
    )
  }

  if (error && (!leads || leads.length === 0)) {
    return <Banner variant="warning" size="sm">{error}</Banner>
  }

  if (!leads || leads.length === 0) {
    return (
      <div className="surface-panel px-6 py-12 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Users size={18} />
        </div>
        <h2 className="mt-3 font-display text-lg font-semibold text-dark">No saved contacts yet</h2>
        <p className="mt-1.5 text-sm text-muted">
          Save contacts from the Leads tab. They'll show up here so you can generate drafts from each.
        </p>
        {onJumpToLeads && (
          <button onClick={onJumpToLeads} className="btn-primary mt-4 text-xs">
            Find leads
          </button>
        )}
      </div>
    )
  }

  const bulkBusy = bulkAction !== null

  return (
    <div className="space-y-3">
      {error && <Banner variant="warning" size="sm">{error}</Banner>}

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
              disabled={bulkBusy || selectedNoDraftLeads.length === 0}
              className="btn-primary inline-flex items-center gap-1.5 text-xs py-1 px-2.5 disabled:opacity-50"
              title={selectedNoDraftLeads.length === 0 ? 'No selected contacts need a draft' : `Generate ${selectedNoDraftLeads.length} draft${selectedNoDraftLeads.length === 1 ? '' : 's'}`}
            >
              {bulkAction?.kind === 'generate' ? <Loader2 size={11} className="animate-spin" /> : <PenLine size={11} />}
              Generate {selectedNoDraftLeads.length > 0 ? `(${selectedNoDraftLeads.length})` : ''}
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
              <th className="px-4 py-3 text-left">Company</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-warm-200/80">
            {leads.map(lead => {
              const status = leadStatus(lead)
              const generating = generatingId === lead.id
              const checked = selectedIds.has(lead.id)
              return (
                <tr key={lead.id} className={`transition-colors hover:bg-warm-50/60 ${checked ? 'bg-warm-50/40' : ''}`}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${lead.contact?.name ?? 'lead'}`}
                      checked={checked}
                      onChange={() => toggleOne(lead.id)}
                      className="cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-dark">{lead.contact?.name ?? 'Unknown'}</div>
                    <div className="text-xs text-muted">{lead.contact?.title ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-dark">{lead.company?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {status === 'no-draft' ? (
                      <button
                        type="button"
                        onClick={() => handleGenerate(lead)}
                        disabled={generating || bulkBusy || !lead.contact}
                        className="btn-primary inline-flex items-center gap-1.5 text-xs py-1 px-2.5 disabled:opacity-50"
                        title={!lead.contact ? 'Save the contact first from the Leads tab' : undefined}
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
    </div>
  )
}
