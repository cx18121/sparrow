import { useEffect, useState, useCallback } from 'react'
import { Loader2, Mail, PenLine, Send, Users } from 'lucide-react'
import Banner from '../ui/Banner'
import { fetchCampaignLeads, generateEmail } from '../../lib/api'
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

  const handleGenerate = async (lead: UserLead) => {
    setGeneratingId(lead.id)
    try {
      await generateEmail({ userLeadId: lead.id, save: true })
      await load() // re-pull so the new draft shows in the status column
    } catch (err) {
      setError((err as Error)?.message || 'Draft generation failed.')
    } finally {
      setGeneratingId(null)
    }
  }

  if (leads === null && !error) {
    return (
      <div className="surface-panel flex items-center gap-2 px-6 py-7 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" /> Loading saved contacts…
      </div>
    )
  }

  if (error) {
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

  return (
    <div className="surface-panel overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-warm-200 bg-warm-50/60 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted/80">
          <tr>
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
            return (
              <tr key={lead.id} className="transition-colors hover:bg-warm-50/60">
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
                      disabled={generating || !lead.contact}
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
  )
}
