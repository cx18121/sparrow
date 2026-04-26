import React, { useState, useEffect } from 'react'
import {
  Plus, Edit2, Pause, Play, Copy, Trash2, Search, Calendar,
  Zap, RotateCcw, ChevronRight, Building2, MapPin, Users, Mail,
  Filter, RefreshCw,
} from 'lucide-react'
import { format } from 'date-fns'
import Badge from '../ui/Badge'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import {
  fetchCampaignBatch, generateCampaignBatch, resetCampaignSeen, fetchCampaignOptions, generateEmail, createEmail,
} from '../../lib/api'

const INITIAL_FORM = {
  name: '', subject: '', status: 'draft',
  templateId: '', scheduledAt: '',
  filterIndustry: '', filterRegion: '', filterStage: '', filterBatch: '',
  filterIsHiring: '', filterHeadcountMin: '', filterHeadcountMax: '',
  batchSize: '10',
}

export default function CampaignsTab({ campaigns, onCreate, onUpdate, onDelete, templates, workspaceConfig }) {
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(INITIAL_FORM)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [saving, setSaving] = useState(false)
  const [pendingActions, setPendingActions] = useState(new Set())
  const [options, setOptions] = useState({ industries: [], regions: [], stages: [], batches: [] })
  const [batchModal, setBatchModal] = useState({ open: false, campaign: null, leads: [], loading: false, usingFallback: false, seenTotal: 0, currentBatch: 0 })
  const [generatingEmail, setGeneratingEmail] = useState(null)
  const [resetTarget, setResetTarget] = useState(null)
  const [emailPreview, setEmailPreview] = useState({ open: false, lead: null, subject: '', body: '', saving: false, error: null })

  const workspaceTemplate = templates.find(t => t.id === workspaceConfig?.templateId)

  useEffect(() => {
    fetchCampaignOptions().then(setOptions).catch(() => {})
  }, [])

  const getInitialForm = () => ({
    ...INITIAL_FORM,
    templateId: workspaceTemplate?.id || '',
    subject: workspaceTemplate?.subject || '',
  })

  const filtered = campaigns.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.subject || '').toLowerCase().includes(search.toLowerCase())
  )

  const openCreate = () => {
    setEditing(null)
    setForm(getInitialForm())
    setModalOpen(true)
  }

  const openEdit = (c) => {
    setEditing(c.id)
    setForm({
      name: c.name,
      subject: c.subject || '',
      status: c.status,
      templateId: c.templateId || '',
      scheduledAt: c.scheduledAt ? c.scheduledAt.slice(0, 16) : '',
      filterIndustry: c.filterIndustry || '',
      filterRegion: c.filterRegion || '',
      filterStage: c.filterStage || '',
      filterBatch: c.filterBatch || '',
      filterIsHiring: c.filterIsHiring == null ? '' : String(c.filterIsHiring),
      filterHeadcountMin: c.filterHeadcountMin != null ? String(c.filterHeadcountMin) : '',
      filterHeadcountMax: c.filterHeadcountMax != null ? String(c.filterHeadcountMax) : '',
      batchSize: String(c.batchSize ?? 10),
    })
    setModalOpen(true)
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    const payload = {
      name: form.name,
      subject: form.subject || null,
      status: form.status,
      templateId: form.templateId || null,
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
      filterIndustry: form.filterIndustry || null,
      filterRegion: form.filterRegion || null,
      filterStage: form.filterStage || null,
      filterBatch: form.filterBatch || null,
      filterIsHiring: form.filterIsHiring === '' ? null : form.filterIsHiring === 'true',
      filterHeadcountMin: form.filterHeadcountMin ? Number(form.filterHeadcountMin) : null,
      filterHeadcountMax: form.filterHeadcountMax ? Number(form.filterHeadcountMax) : null,
      batchSize: Number(form.batchSize) || 10,
    }
    try {
      if (editing) {
        await onUpdate({ id: editing, ...payload })
      } else {
        await onCreate(payload)
      }
      setModalOpen(false)
    } catch (err) {
      console.error('Failed to save campaign', err)
    } finally {
      setSaving(false)
    }
  }

  const withPending = (id, fn) => {
    if (pendingActions.has(id)) return
    setPendingActions(prev => new Set([...prev, id]))
    fn().finally(() => setPendingActions(prev => { const n = new Set(prev); n.delete(id); return n }))
  }

  const toggleStatus = (c) => {
    if (pendingActions.has(c.id)) return
    const next = c.status === 'active' ? 'paused' : 'active'
    withPending(c.id, () => onUpdate({ id: c.id, status: next }).catch(err => console.error('Failed to toggle campaign', err)))
  }

  const duplicate = (c) => {
    if (pendingActions.has(c.id)) return
    withPending(c.id, () => onCreate({
      name: `${c.name} (copy)`,
      subject: c.subject || null,
      status: 'draft',
      templateId: c.templateId || null,
      scheduledAt: c.scheduledAt || null,
      filterIndustry: c.filterIndustry || null,
      filterRegion: c.filterRegion || null,
      filterStage: c.filterStage || null,
      filterBatch: c.filterBatch || null,
      filterIsHiring: c.filterIsHiring ?? null,
      filterHeadcountMin: c.filterHeadcountMin ?? null,
      filterHeadcountMax: c.filterHeadcountMax ?? null,
      batchSize: c.batchSize ?? 10,
    }).catch(err => console.error('Failed to duplicate campaign', err)))
  }

  const remove = (id) => {
    if (pendingActions.has(id)) return
    withPending(id, () => onDelete(id).catch(err => console.error('Failed to delete campaign', err)))
  }

  const openBatchModal = async (campaign) => {
    setBatchModal({ open: true, campaign, leads: [], loading: true, usingFallback: false, seenTotal: 0, currentBatch: 0 })
    try {
      const existing = await fetchCampaignBatch(campaign.id)
      if (existing.currentBatch === 0) {
        // No batch yet — auto-generate the first one
        const data = await generateCampaignBatch(campaign.id)
        setBatchModal(prev => ({ ...prev, leads: data.leads, loading: false, seenTotal: data.seenTotal, currentBatch: data.currentBatch, usingFallback: data.usingFallback ?? false }))
      } else {
        setBatchModal(prev => ({ ...prev, leads: existing.leads, loading: false, seenTotal: existing.seenTotal, currentBatch: existing.currentBatch }))
      }
    } catch (err) {
      console.error('Failed to open batch', err)
      setBatchModal(prev => ({ ...prev, loading: false }))
    }
  }

  const runBatch = async () => {
    if (!batchModal.campaign) return
    setBatchModal(prev => ({ ...prev, loading: true }))
    try {
      const data = await generateCampaignBatch(batchModal.campaign.id)
      setBatchModal(prev => ({
        ...prev,
        loading: false,
        usingFallback: data.usingFallback ?? false,
        seenTotal: data.seenTotal,
        currentBatch: data.currentBatch,
        leads: data.leads,
      }))
    } catch (err) {
      console.error('Failed to generate batch', err)
      setBatchModal(prev => ({ ...prev, loading: false }))
    }
  }

  const doResetSeen = async (campaignId) => {
    await resetCampaignSeen(campaignId)
    setResetTarget(null)
    if (batchModal.open && batchModal.campaign?.id === campaignId) {
      setBatchModal(prev => ({ ...prev, leads: [], seenTotal: 0, currentBatch: 0, usingFallback: false }))
    }
  }

  const handleGenerateEmail = async (lead) => {
    if (!lead.contact && !lead.apolloPersonId) return
    setGeneratingEmail(lead.id)
    try {
      const templateId = batchModal.campaign?.templateId || null
      const result = await generateEmail({ userLeadId: lead.id, templateId, save: false })
      setEmailPreview({ open: true, lead, subject: result.subject || '', body: result.body || '', saving: false, error: null })
    } catch (err) {
      console.error('Failed to generate email', err)
    } finally {
      setGeneratingEmail(null)
    }
  }

  const saveEmailToDrafts = async () => {
    if (!emailPreview.lead) return
    setEmailPreview(prev => ({ ...prev, saving: true, error: null }))
    try {
      const saved = await createEmail({
        userLeadId: emailPreview.lead.id,
        subject: emailPreview.subject,
        body: emailPreview.body,
        status: 'draft',
      })
      setEmailPreview(prev => ({ ...prev, open: false, saving: false }))
      setBatchModal(prev => ({
        ...prev,
        leads: prev.leads.map(l =>
          l.id === emailPreview.lead.id
            ? { ...l, emails: [{ id: saved.id, subject: saved.subject, status: 'draft' }] }
            : l
        ),
      }))
    } catch (err) {
      setEmailPreview(prev => ({ ...prev, saving: false, error: err.message || 'Failed to save' }))
    }
  }

  const field = (key, value) => setForm(f => ({ ...f, [key]: value }))

  const activeFilters = (c) => [
    c.filterIndustry,
    c.filterRegion,
    c.filterStage,
    c.filterBatch,
    c.filterIsHiring != null ? (c.filterIsHiring ? 'Hiring' : 'Not hiring') : null,
    c.filterHeadcountMin || c.filterHeadcountMax
      ? `${c.filterHeadcountMin || 0}–${c.filterHeadcountMax || '∞'} employees`
      : null,
  ].filter(Boolean)

  return (
    <div className="page-shell">
      <section className="page-toolbar">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 items-center gap-3">
            <div className="relative w-full max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search campaigns…"
                className="input pl-9"
              />
            </div>
            <button onClick={openCreate} className="btn-primary shrink-0">
              <Plus size={15} /> New campaign
            </button>
          </div>
          <p className="text-sm text-muted shrink-0">
            {search ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''}` : `${campaigns.length} campaign${campaigns.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </section>

      <section className="table-shell">
        {filtered.length === 0 ? (
          <div className="empty-state border-0 bg-transparent shadow-none">
            {search ? 'No campaigns match your search.' : 'No campaigns yet. Create your first one!'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-[rgba(248,250,252,0.86)]">
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Name</th>
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Filters</th>
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Status</th>
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Batch size</th>
                <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(c => {
                const filters = activeFilters(c)
                return (
                  <tr key={c.id} className="transition-colors hover:bg-[rgba(248,250,252,0.72)]">
                    <td className="px-5 py-4">
                      <p className="font-medium text-dark">{c.name}</p>
                      {c.subject && <p className="mt-0.5 text-xs text-muted truncate max-w-[220px]">{c.subject}</p>}
                    </td>
                    <td className="px-5 py-4">
                      {filters.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {filters.map(f => (
                            <span key={f} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                              <Filter size={9} />{f}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">No filters</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant={c.status}>{c.status}</Badge>
                    </td>
                    <td className="px-5 py-4 text-muted text-xs">
                      {c.batchSize ?? 10} leads/batch
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openBatchModal(c)}
                          className="btn-primary px-2.5 py-1 text-xs"
                          title="View current batch companies"
                        >
                          <Zap size={12} /> Open batch
                        </button>
                        <button onClick={() => openEdit(c)} disabled={pendingActions.has(c.id)} className="btn-ghost px-2 py-1 disabled:opacity-40">
                          <Edit2 size={13} />
                        </button>
                        {(c.status === 'active' || c.status === 'paused') && (
                          <button onClick={() => toggleStatus(c)} disabled={pendingActions.has(c.id)} className="btn-ghost px-2 py-1 disabled:opacity-40">
                            {c.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
                          </button>
                        )}
                        <button onClick={() => duplicate(c)} disabled={pendingActions.has(c.id)} className="btn-ghost px-2 py-1 disabled:opacity-40">
                          <Copy size={13} />
                        </button>
                        <button onClick={() => setDeleteTarget(c.id)} disabled={pendingActions.has(c.id)} className="btn-ghost px-2 py-1 hover:text-red-500 disabled:opacity-40">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Create / Edit modal */}
<<<<<<< HEAD
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit campaign' : 'New campaign'} size="lg">
        <div className="px-6 py-4 space-y-5">
          {/* Basic info */}
          <div className="space-y-3">
            <div>
              <label className="label">Campaign name *</label>
              <input value={form.name} onChange={e => field('name', e.target.value)} placeholder="e.g. YC W24 Founders Outreach" className="input" required />
            </div>
            <div>
              <label className="label">Subject line</label>
              <input value={form.subject} onChange={e => field('subject', e.target.value)} placeholder="e.g. Quick question about {{company}}" className="input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Linked template</label>
                <select value={form.templateId} onChange={e => field('templateId', e.target.value)} className="select">
                  <option value="">Select template…</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Linked sequence</label>
                <select value={form.sequenceId} onChange={e => field('sequenceId', e.target.value)} className="select">
                  <option value="">Select sequence…</option>
                  {sequences.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Status</label>
                <select value={form.status} onChange={e => field('status', e.target.value)} className="select">
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div>
                <label className="label">Schedule (optional)</label>
                <input type="datetime-local" value={form.scheduledAt} onChange={e => field('scheduledAt', e.target.value)} className="input" />
              </div>
            </div>
=======
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit campaign' : 'New campaign'} size="md">
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="label">Campaign name *</label>
            <input value={form.name} onChange={e => field('name', e.target.value)} placeholder="e.g. YC W24 Founders Outreach" className="input" required />
          </div>
          <div>
            <label className="label">Subject line</label>
            <input value={form.subject} onChange={e => field('subject', e.target.value)} placeholder="e.g. Quick question about {{company}}" className="input" />
          </div>

          <div>
            <label className="label">Linked template</label>
            <select value={form.templateId} onChange={e => field('templateId', e.target.value)} className="select">
              <option value="">Select template…</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
>>>>>>> 0776ae0 (remove all sequences references from codebase)
          </div>

          {/* Lead filters */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-muted/80">Lead filters</p>
            <div className="space-y-3 rounded-[20px] border border-slate-100 bg-slate-50/60 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Industry</label>
                  <select value={form.filterIndustry} onChange={e => field('filterIndustry', e.target.value)} className="select">
                    <option value="">Any industry</option>
                    {options.industries.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Region</label>
                  <select value={form.filterRegion} onChange={e => field('filterRegion', e.target.value)} className="select">
                    <option value="">Any region</option>
                    {options.regions.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Stage</label>
                  <select value={form.filterStage} onChange={e => field('filterStage', e.target.value)} className="select">
                    <option value="">Any stage</option>
                    {options.stages.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">YC Batch</label>
                  <select value={form.filterBatch} onChange={e => field('filterBatch', e.target.value)} className="select">
                    <option value="">Any batch</option>
                    {options.batches.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Hiring status</label>
                  <select value={form.filterIsHiring} onChange={e => field('filterIsHiring', e.target.value)} className="select">
                    <option value="">Any</option>
                    <option value="true">Actively hiring</option>
                    <option value="false">Not hiring</option>
                  </select>
                </div>
                <div>
                  <label className="label">Min employees</label>
                  <input type="number" min="0" value={form.filterHeadcountMin} onChange={e => field('filterHeadcountMin', e.target.value)} placeholder="e.g. 10" className="input" />
                </div>
                <div>
                  <label className="label">Max employees</label>
                  <input type="number" min="0" value={form.filterHeadcountMax} onChange={e => field('filterHeadcountMax', e.target.value)} placeholder="e.g. 200" className="input" />
                </div>
              </div>
            </div>
          </div>

          {/* Batch size */}
          <div>
            <label className="label">Leads per batch</label>
            <div className="flex items-center gap-3">
              <input
                type="number" min="1" max="100"
                value={form.batchSize}
                onChange={e => field('batchSize', e.target.value)}
                className="input w-28"
              />
              <p className="text-xs text-muted">How many companies to pull each time you run this campaign (max 100).</p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={save} disabled={saving || !form.name} className="btn-primary">
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create campaign'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Batch results modal */}
      <Modal
        open={batchModal.open}
        onClose={() => setBatchModal(prev => ({ ...prev, open: false }))}
        title={batchModal.campaign
          ? `${batchModal.campaign.name}${batchModal.currentBatch > 0 ? ` — Batch ${batchModal.currentBatch}` : ''}`
          : 'Batch'}
        size="xl"
      >
        <div className="flex flex-col" style={{ maxHeight: '75vh' }}>
          {/* Toolbar */}
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-3">
            <p className="text-sm text-muted">
              {batchModal.currentBatch === 0
                ? 'No batch generated yet'
                : `${batchModal.leads.length} lead${batchModal.leads.length !== 1 ? 's' : ''} in batch ${batchModal.currentBatch}`}
              {batchModal.seenTotal > 0 && (
                <span className="ml-2 text-xs text-muted/70">· {batchModal.seenTotal} companies seen across all batches</span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setResetTarget(batchModal.campaign?.id)}
                className="btn-ghost text-xs"
                title="Clear all batches and seen history to start fresh"
              >
                <RotateCcw size={12} /> Reset all
              </button>
              <button
                onClick={runBatch}
                disabled={batchModal.loading}
                className="btn-primary text-xs"
              >
                {batchModal.loading ? (
                  <><RefreshCw size={12} className="animate-spin" /> Generating…</>
                ) : batchModal.currentBatch === 0 ? (
                  <><Zap size={12} /> Generate first batch</>
                ) : (
                  <><Zap size={12} /> Next batch</>
                )}
              </button>
            </div>
          </div>

          {batchModal.usingFallback && (
            <div className="mx-6 mt-4 rounded-[16px] border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              All matching companies have been seen — showing previously seen companies. Click "Reset all" to start fresh.
            </div>
          )}

          {/* Lead list */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {batchModal.loading && batchModal.leads.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-sm text-muted">
                <RefreshCw size={16} className="animate-spin mr-2" /> Loading…
              </div>
            ) : batchModal.leads.length === 0 ? (
              <div className="empty-state border-0 bg-transparent shadow-none py-16">
                No leads yet. Click "Generate" to pull the first batch.
              </div>
            ) : (
              <div className="space-y-3">
                {batchModal.leads.map(lead => (
                  <div key={lead.id} className="rounded-[20px] border border-white/80 bg-white/82 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-dark">{lead.company?.name}</p>
                          {lead.company?.isHiring && (
                            <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">Hiring</span>
                          )}
                          {lead.company?.batch && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{lead.company.batch}</span>
                          )}
                        </div>
                        {lead.company?.oneLiner && (
                          <p className="mt-1 text-xs text-muted line-clamp-1">{lead.company.oneLiner}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
                          {lead.company?.industry && (
                            <span className="flex items-center gap-1"><Building2 size={10} />{lead.company.industry}</span>
                          )}
                          {lead.company?.region && (
                            <span className="flex items-center gap-1"><MapPin size={10} />{lead.company.region}</span>
                          )}
                          {lead.contact ? (
                            <span className="flex items-center gap-1 text-slate-700">
                              <Users size={10} />
                              {lead.contact.name || 'Contact'}{lead.contact.title ? ` — ${lead.contact.title}` : ''}
                              {lead.contact.email && <span className="text-primary">· {lead.contact.email}</span>}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-amber-600"><Users size={10} /> No contact yet</span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {lead.emails?.length > 0 ? (
                          <span className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                            <Mail size={10} /> Draft ready
                          </span>
                        ) : (lead.contact || lead.apolloPersonId) ? (
                          <button
                            onClick={() => handleGenerateEmail(lead)}
                            disabled={generatingEmail === lead.id}
                            className="btn-secondary text-xs"
                          >
                            {generatingEmail === lead.id ? (
                              <><RefreshCw size={10} className="animate-spin" /> Generating…</>
                            ) : (
                              <><Mail size={10} /> Generate email</>
                            )}
                          </button>
                        ) : (
                          <span className="text-xs text-muted">No contact found</span>
                        )}
                      </div>
                    </div>

                    {lead.emails?.length > 0 && (
                      <div className="mt-3 rounded-[12px] border border-slate-100 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-medium text-dark">{lead.emails[0].subject}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => remove(deleteTarget)}
        title="Delete campaign"
        message="Are you sure you want to delete this campaign? This action cannot be undone."
      />

      <ConfirmDialog
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        onConfirm={() => doResetSeen(resetTarget)}
        title="Reset all batches"
        message="This will delete all batch history and seen companies for this campaign so you start fresh. Leads already saved to your contacts are not affected."
      />

      {/* Email preview & save modal */}
      <Modal
        open={emailPreview.open}
        onClose={() => setEmailPreview(prev => ({ ...prev, open: false }))}
        title={emailPreview.lead ? `Email for ${emailPreview.lead.company?.name || 'contact'}` : 'Generated email'}
        size="md"
      >
        <div className="px-6 py-4 space-y-4">
          {/* Company / contact context */}
          {emailPreview.lead && (
            <div className="rounded-[16px] border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-muted space-y-1">
              <div className="flex items-center gap-4">
                {emailPreview.lead.company?.name && (
                  <span className="flex items-center gap-1"><Building2 size={10} /> {emailPreview.lead.company.name}</span>
                )}
                {emailPreview.lead.company?.industry && (
                  <span>{emailPreview.lead.company.industry}</span>
                )}
                {emailPreview.lead.company?.region && (
                  <span className="flex items-center gap-1"><MapPin size={10} /> {emailPreview.lead.company.region}</span>
                )}
              </div>
              {emailPreview.lead.contact && (
                <div className="flex items-center gap-1 text-slate-600">
                  <Users size={10} />
                  {emailPreview.lead.contact.name || 'Contact'}
                  {emailPreview.lead.contact.title && ` — ${emailPreview.lead.contact.title}`}
                  {emailPreview.lead.contact.email && (
                    <span className="ml-1 text-primary">{emailPreview.lead.contact.email}</span>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="label">Subject</label>
            <input
              value={emailPreview.subject}
              onChange={e => setEmailPreview(prev => ({ ...prev, subject: e.target.value }))}
              className="input"
              placeholder="Subject line"
            />
          </div>

          <div>
            <label className="label">Body</label>
            <textarea
              value={emailPreview.body}
              onChange={e => setEmailPreview(prev => ({ ...prev, body: e.target.value }))}
              rows={14}
              className="input resize-y font-mono text-xs leading-relaxed"
              placeholder="Email body…"
            />
          </div>

          {emailPreview.error && (
            <p className="text-xs text-red-500">{emailPreview.error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setEmailPreview(prev => ({ ...prev, open: false }))}
              className="btn-secondary"
            >
              Discard
            </button>
            <button
              onClick={saveEmailToDrafts}
              disabled={emailPreview.saving}
              className="btn-primary"
            >
              {emailPreview.saving ? 'Saving…' : 'Save to drafts'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
