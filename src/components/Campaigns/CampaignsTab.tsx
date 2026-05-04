import React, { useState, useEffect } from 'react'
import {
  Plus, Edit2, Pause, Play, Copy, Trash2, Search,
  Zap, RotateCcw, Building2, MapPin, Users, Mail,
  RefreshCw, X,
} from 'lucide-react'
import Badge from '../ui/Badge'
import Banner from '../ui/Banner'
import EmptyState from '../ui/EmptyState'
import Pill from '../ui/Pill'
import ConfirmDialog from '../ui/ConfirmDialog'
import Toast from '../ui/Toast'
import {
  fetchCampaignBatch, generateCampaignBatch, resetCampaignSeen, fetchCampaignOptions,
  fetchCampaignLeads, deleteCampaignLead,
} from '../../lib/api'
import { useAppData, type UiCampaign } from '../../contexts/AppDataContext'
import { audienceFromCampaign, audienceToDisplayPills } from '../../types/audience'
import { useDraftFlow } from '../../hooks/useDraftFlow'
import DraftPreviewModal from './DraftPreviewModal'
import CampaignFormModal, { INITIAL_FORM, fromCampaign, type CampaignFormValue } from './CampaignFormModal'

export default function CampaignsTab({ workspaceConfig, onNavigate, onEnterCampaign, activeCampaign = null, exitCampaign = null }) {
  const {
    campaigns,
    templates,
    dataLoaded,
    createCampaign: onCreate,
    updateCampaign: onUpdate,
    deleteCampaign: onDelete,
  } = useAppData()
  const isLoading = !dataLoaded
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<UiCampaign | null>(null)
  const [formInitial, setFormInitial] = useState<CampaignFormValue>(INITIAL_FORM)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [saving, setSaving] = useState(false)
  const [pendingActions, setPendingActions] = useState(new Set())
  const [options, setOptions] = useState({ industries: [], regions: [], stages: [], batches: [], tags: {} })
  const [batchModal, setBatchModal] = useState({ open: false, campaign: null, leads: [], loading: false, usingFallback: false, seenTotal: 0, currentBatch: 0, generationAttempted: false })
  const [generatingEmail, setGeneratingEmail] = useState(null)
  const [resetTarget, setResetTarget] = useState(null)
  // Draft flow is owned by useDraftFlow; preview just tracks which lead is open.
  const [previewLead, setPreviewLead] = useState(null)
  const draftFlow = useDraftFlow()
  const [campaignLeads, setCampaignLeads] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)

  // Detail view is driven by the global activeCampaign prop, not local state.
  const detailCampaign = activeCampaign
    ? campaigns.find(c => c.id === activeCampaign.id) || null
    : null
  const [toast, setToast] = useState(null)

  const reportError = (title, err) => {
    console.error(title, err)
    setToast({ type: 'error', title, message: err?.message || 'Please try again.' })
  }

  const workspaceTemplate = templates.find(t => t.id === workspaceConfig?.templateId)

  useEffect(() => {
    fetchCampaignOptions().then(setOptions).catch(() => {})
  }, [])

  const getInitialForm = (): CampaignFormValue => ({
    ...INITIAL_FORM,
    templateId: workspaceTemplate?.id || '',
    subject: workspaceTemplate?.subject || '',
  })

  const filtered = campaigns.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.subject || '').toLowerCase().includes(search.toLowerCase())
  )

  const loadCampaignDetail = async (campaignId) => {
    setDetailLoading(true)
    try {
      const members = await fetchCampaignLeads(campaignId)
      setCampaignLeads(members?.items || [])
    } catch (err) {
      reportError('Could not load campaign', err)
    } finally {
      setDetailLoading(false)
    }
  }

  // Load campaign leads whenever the active campaign changes.
  useEffect(() => {
    if (activeCampaign?.id) {
      loadCampaignDetail(activeCampaign.id)
    } else {
      setCampaignLeads([])
    }
  }, [activeCampaign?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const removeLeadFromCampaign = async (campaignLeadId) => {
    try {
      await deleteCampaignLead(campaignLeadId)
      setCampaignLeads(prev => prev.filter(lead => lead.campaignLeadId !== campaignLeadId))
    } catch (err) {
      reportError('Could not remove prospect', err)
    }
  }

  const openCreate = () => {
    setEditing(null)
    setFormInitial(getInitialForm())
    setModalOpen(true)
  }

  const openEdit = (c: UiCampaign) => {
    setEditing(c)
    setFormInitial(fromCampaign(c))
    setModalOpen(true)
  }

  const handleFormSave = async (form: CampaignFormValue) => {
    if (saving) return
    setSaving(true)
    const payload = {
      name: form.name,
      subject: form.subject || null,
      status: form.status,
      templateId: form.templateId || null,
      filterTags: form.filterTags || [],
      filterRegion: form.filterRegion || null,
      filterStage: form.filterStage || null,
      filterBatch: form.filterBatch || null,
      filterIsHiring: form.filterIsHiring || null,
      filterHeadcountMin: form.filterHeadcountMin ? Number(form.filterHeadcountMin) : null,
      filterHeadcountMax: form.filterHeadcountMax ? Number(form.filterHeadcountMax) : null,
      batchSize: Number(form.batchSize) || 10,
      tone: form.tone || null,
      attachmentIds: form.attachmentIds || [],
    }
    try {
      if (editing) {
        await onUpdate({ id: editing.id, ...payload })
        setModalOpen(false)
      } else {
        const created = await onCreate(payload)
        setModalOpen(false)
        if (created && onEnterCampaign) onEnterCampaign(created)
      }
    } catch (err) {
      reportError('Could not save campaign', err)
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
    withPending(c.id, () => onUpdate({ id: c.id, status: next }).catch(err => reportError(`Could not ${next === 'active' ? 'resume' : 'pause'} campaign`, err)))
  }

  const duplicate = (c) => {
    if (pendingActions.has(c.id)) return
    withPending(c.id, () => onCreate({
      name: `${c.name} (copy)`,
      subject: c.subject || null,
      status: 'draft',
      templateId: c.templateId || null,
      filterTags: c.filterTags || [],
      filterRegion: c.filterRegion || null,
      filterStage: c.filterStage || null,
      filterBatch: c.filterBatch || null,
      filterIsHiring: c.filterIsHiring ?? null,
      filterHeadcountMin: c.filterHeadcountMin ?? null,
      filterHeadcountMax: c.filterHeadcountMax ?? null,
      batchSize: c.batchSize ?? 10,
      tone: c.tone || null,
      attachmentIds: Array.isArray(c.attachmentIds) ? c.attachmentIds : [],
    }).catch(err => reportError('Could not duplicate campaign', err)))
  }

  const remove = (id) => {
    if (pendingActions.has(id)) return
    withPending(id, () => onDelete(id).catch(err => reportError('Could not delete campaign', err)))
  }

  const openBatchModal = async (campaign) => {
    setBatchModal({ open: true, campaign, leads: [], loading: true, usingFallback: false, seenTotal: 0, currentBatch: 0, generationAttempted: false })
    try {
      const existing = await fetchCampaignBatch(campaign.id)
      if (existing.currentBatch === 0) {
        // No batch yet. Auto-generate the first one.
        const data = await generateCampaignBatch(campaign.id)
        setBatchModal(prev => ({ ...prev, leads: data.leads, loading: false, seenTotal: data.seenTotal, currentBatch: data.currentBatch, usingFallback: data.usingFallback ?? false, generationAttempted: true }))
        if (activeCampaign?.id === campaign.id) loadCampaignDetail(campaign.id)
      } else {
        setBatchModal(prev => ({ ...prev, leads: existing.leads, loading: false, seenTotal: existing.seenTotal, currentBatch: existing.currentBatch, generationAttempted: false }))
      }
    } catch (err) {
      reportError('Could not open batch', err)
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
        generationAttempted: true,
      }))
      if (activeCampaign?.id === batchModal.campaign.id) loadCampaignDetail(batchModal.campaign.id)
    } catch (err) {
      reportError('Could not generate batch', err)
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
      const campaignContext = batchModal.campaign || detailCampaign
      await draftFlow.generate({ kind: 'lead', id: lead.id }, {
        templateId: campaignContext?.templateId || null,
        tone: campaignContext?.tone || undefined,
        includeResumeBullet: true,
      })
      setPreviewLead(lead)
    } catch (err) {
      reportError('Could not generate email', err)
      if ((err as any)?.status === 404 && detailCampaign?.id) {
        loadCampaignDetail(detailCampaign.id)
      }
    } finally {
      setGeneratingEmail(null)
    }
  }

  const saveEmailToDrafts = async () => {
    if (!previewLead) return
    try {
      const campaignContext = batchModal.campaign || detailCampaign
      const attachmentIds = Array.isArray(campaignContext?.attachmentIds) ? campaignContext.attachmentIds : []
      const saved = await draftFlow.save({ kind: 'lead', id: previewLead.id }, attachmentIds)
      setPreviewLead(null)
      draftFlow.reset()
      const leadId = previewLead.id
      setBatchModal(prev => ({
        ...prev,
        leads: prev.leads.map(l =>
          l.id === leadId ? { ...l, emails: [{ id: saved.id, subject: saved.subject, status: 'draft' }] } : l
        ),
      }))
      setCampaignLeads(prev => prev.map(l =>
        l.id === leadId ? { ...l, emails: [{ id: saved.id, subject: saved.subject, status: 'draft' }] } : l
      ))
    } catch {
      // draftFlow.error has the message
    }
  }

  // Display pills delegate to the shared CampaignAudience module so the
  // front-end and back-end stay in lockstep about what each filter means.
  const activeFilters = (c) => audienceToDisplayPills(audienceFromCampaign(c))

  const detailFilters = detailCampaign ? activeFilters(detailCampaign) : []
  const sourceLabel = (lead) => lead.batchNumber > 0 ? `Batch ${lead.batchNumber}` : 'Added manually'

  return (
    <div className="page-shell">
      <Toast toast={toast} onClose={() => setToast(null)} />
      {detailCampaign ? (
        <>
        <section className="page-toolbar">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="page-eyebrow">Campaign</p>
              <h1 className="mt-1 font-display text-3xl font-semibold tracking-[-0.02em] text-dark">
                {detailCampaign.name}
              </h1>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <Badge variant={detailCampaign.status}>{detailCampaign.status}</Badge>
                <span className="text-xs text-muted">
                  {campaignLeads.length} prospect{campaignLeads.length === 1 ? '' : 's'}
                </span>
                {detailCampaign.template?.name && (
                  <>
                    <span className="select-none text-muted/40">·</span>
                    <span className="text-xs text-muted">{detailCampaign.template.name}</span>
                  </>
                )}
                {detailFilters.length > 0 && (
                  <>
                    <span className="select-none text-muted/40">·</span>
                    {detailFilters.map(f => (
                      <Pill key={f} variant="neutral" className="px-2 py-0.5 text-[11px]">{f}</Pill>
                    ))}
                  </>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" onClick={() => openEdit(detailCampaign)} className="btn-secondary text-xs">
                <Edit2 size={13} /> Edit
              </button>
              {onNavigate && (
                <button type="button" onClick={() => onNavigate('leads')} className="btn-secondary text-xs">
                  <Search size={13} /> Discover
                </button>
              )}
              <button type="button" onClick={() => openBatchModal(detailCampaign)} className="btn-primary text-xs">
                <Zap size={13} /> Find prospects
              </button>
            </div>
          </div>
        </section>

        {/* Inline batch panel */}
        {batchModal.open && batchModal.campaign?.id === activeCampaign?.id && (
          <section className="rounded-[24px] border border-warm-200 bg-warm-50/60 p-5">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="page-eyebrow">Latest batch</p>
                <p className="mt-1 text-sm text-muted">
                  {batchModal.currentBatch === 0
                    ? 'No batch generated yet.'
                    : `${batchModal.leads.length} prospect${batchModal.leads.length !== 1 ? 's' : ''} in batch ${batchModal.currentBatch}.`}
                  {batchModal.seenTotal > 0 && (
                    <span className="ml-2 text-xs text-muted/70">{batchModal.seenTotal} seen across all batches.</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setResetTarget(batchModal.campaign?.id)}
                  className="btn-ghost text-xs"
                  title="Clear seen history to start fresh"
                >
                  <RotateCcw size={12} /> Reset history
                </button>
                <button
                  type="button"
                  onClick={runBatch}
                  disabled={batchModal.loading}
                  className="btn-primary text-xs"
                >
                  {batchModal.loading ? (
                    <><RefreshCw size={12} className="animate-spin" /> Finding...</>
                  ) : batchModal.currentBatch === 0 ? (
                    <><Zap size={12} /> Find first matches</>
                  ) : (
                    <><Zap size={12} /> Find next matches</>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setBatchModal(prev => ({ ...prev, open: false }))}
                  className="btn-ghost px-2 py-1 text-xs"
                  title="Close batch panel"
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {batchModal.usingFallback && (
              <Banner variant="warning" size="sm" className="mb-3">
                All matching prospects have been seen. Showing previously seen prospects. Reset history to start fresh.
              </Banner>
            )}

            {batchModal.loading && batchModal.leads.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted">
                <RefreshCw size={16} className="animate-spin mr-2" /> Loading...
              </div>
            ) : batchModal.leads.length === 0 ? (
              <EmptyState>
                {batchModal.generationAttempted
                  ? 'No prospects match these filters. Try broadening Stage or Region.'
                  : 'Run the batch to load matches.'}
              </EmptyState>
            ) : (
              <div className="space-y-3">
                {batchModal.leads.map(lead => (
                  <div key={lead.id} className="rounded-[20px] border border-warm-200 bg-warm-50 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-dark">{lead.company?.name}</p>
                          {lead.company?.isHiring && (
                            <Pill variant="success">Hiring</Pill>
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
                            <span className="flex items-center gap-1 text-stone-700">
                              <Users size={10} />
                              {lead.contact.name || 'Contact'}{lead.contact.title ? ` · ${lead.contact.title}` : ''}
                              {lead.contact.email && <span className="text-primary">· {lead.contact.email}</span>}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-amber-600"><Users size={10} /> No contact yet</span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {lead.emails?.length > 0 ? (
                          <Pill icon={Mail} variant="success" className="text-xs px-2.5 py-1">
                            Draft ready
                          </Pill>
                        ) : (lead.contact || lead.apolloPersonId) ? (
                          <button
                            onClick={() => handleGenerateEmail(lead)}
                            disabled={generatingEmail === lead.id}
                            className="btn-secondary text-xs"
                          >
                            {generatingEmail === lead.id ? (
                              <><RefreshCw size={10} className="animate-spin" /> Generating...</>
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
                      <div className="mt-3 rounded-[12px] border border-warm-200 bg-warm-50 px-3 py-2">
                        <p className="text-xs font-medium text-dark">{lead.emails[0].subject}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-dark">Prospects in this campaign</h2>
            <button type="button" onClick={() => loadCampaignDetail(detailCampaign.id)} className="btn-ghost px-2 py-1 text-xs">
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
          {detailLoading ? (
            <div className="py-12 text-center text-sm text-muted">Loading prospects...</div>
          ) : campaignLeads.length === 0 ? (
            <EmptyState>
              No prospects in this campaign yet. Add saved prospects or find matches from your filters.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {campaignLeads.map(lead => (
                <div key={lead.campaignLeadId} className="rounded-2xl border border-warm-200 bg-warm-50 px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-dark">{lead.company?.name || 'Unknown company'}</p>
                        <Pill variant="neutral">{sourceLabel(lead)}</Pill>
                        {lead.company?.isHiring && (
                          <Pill variant="success">Hiring</Pill>
                        )}
                      </div>
                      {lead.company?.oneLiner && <p className="mt-1 text-sm text-muted">{lead.company.oneLiner}</p>}
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                        {lead.company?.industry && <span className="flex items-center gap-1"><Building2 size={10} /> {lead.company.industry}</span>}
                        {lead.company?.region && <span className="flex items-center gap-1"><MapPin size={10} /> {lead.company.region}</span>}
                        {lead.contact ? (
                          <span className="flex items-center gap-1"><Users size={10} /> {lead.contact.name || 'Contact'}{lead.contact.title ? ` · ${lead.contact.title}` : ''}</span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-600"><Users size={10} /> No contact yet</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {lead.emails?.length > 0 && (
                        <Pill variant="success" className="text-xs px-2 py-1">
                          Draft ready
                        </Pill>
                      )}
                      <button type="button" onClick={() => handleGenerateEmail(lead)} disabled={generatingEmail === lead.id || (!lead.contact && !lead.apolloPersonId)} className="btn-secondary text-xs">
                        <Mail size={11} /> {generatingEmail === lead.id ? 'Generating...' : 'Generate email'}
                      </button>
                      <button type="button" onClick={() => removeLeadFromCampaign(lead.campaignLeadId)} className="btn-ghost px-2 py-1 hover:text-red-500" title="Remove from campaign">
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        </>
      ) : (
        <>
      <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="page-eyebrow">Campaigns</h2>
          <p className="page-subtitle mt-1">Pick a campaign to start working on it, or create a new one.</p>
        </div>
        <button onClick={openCreate} className="btn-primary shrink-0 self-start sm:self-auto">
          <Plus size={15} /> New campaign
        </button>
      </div>

      {(campaigns.length > 0 || search) && (
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search campaigns..."
              className="input pl-9"
            />
          </div>
          <p className="text-sm text-muted shrink-0">
            {search
              ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`
              : `${campaigns.length} campaign${campaigns.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      )}

      <section className="table-shell">
        {isLoading && campaigns.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted/60">Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={search ? Search : undefined}
            title={search ? 'No campaigns match' : 'No campaigns yet'}
            description={
              search
                ? 'Try a different search term or clear to see all campaigns.'
                : 'Create a campaign, set audience filters, then generate personalised emails in bulk.'
            }
            action={
              !search && (
                <button type="button" onClick={openCreate} className="btn-primary px-6 py-2.5 text-sm">
                  <Plus size={15} /> Create your first campaign
                </button>
              )
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm-200 bg-warm-50/80">
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Name</th>
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Filters</th>
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Status</th>
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Batch</th>
                <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-200">
              {filtered.map(c => {
                const filters = activeFilters(c)
                return (
                  <tr
                    key={c.id}
                    onClick={() => onEnterCampaign?.(c)}
                    className="cursor-pointer transition-colors hover:bg-warm-50/60"
                  >
                    <td className="px-5 py-4">
                      <p className="font-medium text-dark">{c.name}</p>
                      {c.subject && <p className="mt-0.5 text-xs text-muted truncate max-w-[220px]">{c.subject}</p>}
                    </td>
                    <td className="px-5 py-4">
                      {filters.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {filters.map(f => (
                            <Pill key={f} icon={Filter} variant="neutral" className="text-[11px]">
                              {f}
                            </Pill>
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
                      {c.batchSize ?? 10}/run
                    </td>
                    <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
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
        </>
      )}


      <CampaignFormModal
        open={modalOpen}
        editing={Boolean(editing)}
        initialForm={formInitial}
        templates={templates}
        options={options}
        workspaceConfig={workspaceConfig}
        saving={saving}
        onClose={() => setModalOpen(false)}
        onSave={handleFormSave}
      />

      {/* Batch results render inline inside the campaign detail view above. */}

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
        message="This will delete match history and seen prospects for this campaign so you start fresh. Prospects already saved to your contacts are not affected."
      />

      {/* Email preview & save modal */}
      <DraftPreviewModal
        lead={previewLead}
        draftFlow={draftFlow}
        onClose={() => { setPreviewLead(null); draftFlow.reset() }}
        onSave={saveEmailToDrafts}
      />
    </div>
  )
}
