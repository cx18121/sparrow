import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { Filter, Trash2 } from 'lucide-react'
import Banner from '../ui/Banner'
import ConfirmDialog from '../ui/ConfirmDialog'
import { fetchCampaignOptions } from '../../lib/api'
import { useToast } from '../../contexts/ToastContext'
import { useAppData, type UiCampaign } from '../../contexts/AppDataContext'
import { REGION_INTL, REGION_REMOTE, REGION_US } from '../../types/audience'
import type { CampaignOptions } from '../../types/api'
import type { WorkspaceOutletContext } from './WorkspaceShell'
import { getAttachmentLibrary } from '../../lib/attachments'
import { fillTemplateTags, stripPreviewHtml } from '../../lib/templatePreview'

// Phase 4d: inline campaign editor that replaces CampaignFormModal in the
// workspace. Same field set minus `tone` (dropped per redesign) and minus the
// status select for "create" mode (this surface only edits an existing
// campaign). Save is gated on dirty state; a danger-zone Delete sits at the
// bottom and pushes back to /dashboard on success.

const CAMPAIGN_NS = ['vertical', 'tech', 'model', 'investor', 'signal'] as const
const NS_LABELS: Record<string, string> = {
  stage: 'Stage', vertical: 'Sector', tech: 'Tech',
  model: 'Model', investor: 'Investor', signal: 'Signal',
}
// Per-namespace chip cap before the "+ N more" expander shows. Mirrors
// CHIP_VISIBLE_CAP in CreateCampaignWizard.tsx and LeadDiscoveryTab.tsx —
// these three surfaces share the chip filter contract.
const CHIP_VISIBLE_CAP = 10

interface FormValue {
  name: string
  subject: string
  status: 'active' | 'paused' | 'completed'
  templateId: string
  filterTags: string[]
  filterRegion: string[]
  filterStage: string[]
  filterBatch: string[]
  filterIsHiring: boolean
  batchSize: string
  attachmentIds: string[]
  includePreviouslySaved: boolean
}

// Accept legacy scalar-shape campaigns until cached clients refresh.
function toFilterArray(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function fromCampaign(c: UiCampaign): FormValue {
  return {
    name: c.name,
    subject: c.subject || '',
    status: c.status,
    templateId: c.templateId || '',
    filterTags: c.filterTags || [],
    filterRegion: toFilterArray(c.filterRegion),
    filterStage: toFilterArray(c.filterStage),
    filterBatch: toFilterArray(c.filterBatch),
    filterIsHiring: c.filterIsHiring === true,
    batchSize: String(c.batchSize ?? 10),
    attachmentIds: Array.isArray(c.attachmentIds) ? c.attachmentIds : [],
    includePreviouslySaved: c.includePreviouslySaved === true,
  }
}

export default function SettingsTab() {
  const { campaign, workspaceConfig } = useOutletContext<WorkspaceOutletContext>()
  const { templates, updateCampaign, deleteCampaign } = useAppData()
  const navigate = useNavigate()

  const initial = useMemo(() => fromCampaign(campaign), [campaign])
  const [form, setForm] = useState<FormValue>(initial)
  const [options, setOptions] = useState<CampaignOptions>({
    industries: [], regions: [], stages: [], batches: [], tags: {},
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [expandedNs, setExpandedNs] = useState<Set<string>>(() => new Set())
  const { showToast } = useToast()

  // Re-sync form when the underlying campaign mutates from elsewhere (e.g. a
  // status toggle from the header). Keeps the inline editor consistent with
  // the source of truth without surprising the user mid-edit.
  useEffect(() => {
    setForm(initial)
  }, [initial])

  useEffect(() => {
    fetchCampaignOptions().then(setOptions).catch(() => {})
  }, [])

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial])
  const selectedTemplate = useMemo(
    () => (form.templateId ? templates.find(t => t.id === form.templateId) ?? null : null),
    [form.templateId, templates],
  )

  const field = <K extends keyof FormValue>(key: K, value: FormValue[K]) =>
    setForm(f => {
      const next = { ...f, [key]: value }
      if (key === 'templateId' && value) {
        const tpl = templates.find(t => t.id === value)
        if (tpl?.subject) next.subject = tpl.subject
      }
      return next
    })

  const toggleFilterTag = (namespaced: string) =>
    setForm(f => {
      const current = f.filterTags || []
      const has = current.includes(namespaced)
      return { ...f, filterTags: has ? current.filter(t => t !== namespaced) : [...current, namespaced] }
    })

  const onSave = async () => {
    if (saving || !dirty || !form.name) return
    setSaving(true)
    try {
      await updateCampaign({
        id: campaign.id,
        name: form.name,
        subject: form.subject || null,
        status: form.status,
        templateId: form.templateId || null,
        filterTags: form.filterTags || [],
        filterRegion: form.filterRegion,
        filterStage: form.filterStage,
        filterBatch: form.filterBatch,
        filterIsHiring: form.filterIsHiring || null,
        batchSize: Number(form.batchSize) || 10,
        attachmentIds: form.attachmentIds || [],
        includePreviouslySaved: form.includePreviouslySaved,
      })
      showToast({ type: 'success', title: 'Saved' })
    } catch (err) {
      showToast({ type: 'error', title: 'Could not save', message: (err as Error)?.message })
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      await deleteCampaign(campaign.id)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setDeleting(false)
      showToast({ type: 'error', title: 'Could not delete campaign', message: (err as Error)?.message })
    }
  }

  const files = getAttachmentLibrary(workspaceConfig)

  return (
    <div className="space-y-6">
      {/* Header row - title + Save bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-dark">Campaign settings</h2>
          <p className="mt-0.5 text-sm text-muted">Campaign details, audience, and defaults.</p>
        </div>
        {dirty && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setForm(initial)} className="btn-secondary text-xs" disabled={saving}>
              Discard
            </button>
            <button type="button" onClick={onSave} disabled={saving || !form.name} className="btn-primary text-xs">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>

      {/* Basic info */}
      <section className="surface-panel space-y-3 px-5 py-5">
        <h3 className="text-base font-semibold text-dark">Basics</h3>
        <div>
          <label htmlFor="campaign-settings-name" className="label">Campaign name *</label>
          <input
            id="campaign-settings-name"
            value={form.name}
            onChange={e => field('name', e.target.value)}
            className="input"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="campaign-settings-template" className="label">Template</label>
            <select id="campaign-settings-template" value={form.templateId} onChange={e => field('templateId', e.target.value)} className="select">
              <option value="">Select template…</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="campaign-settings-status" className="label">Status</label>
            <select
              id="campaign-settings-status"
              value={form.status}
              onChange={e => field('status', e.target.value as FormValue['status'])}
              className="select"
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>
        {/* Live template preview so switching templates here gets the same
            sample-filled preview the wizard shows. Without this, users
            can re-point a running campaign at a new template and not see
            what their next drafts will look like until generation runs. */}
        {selectedTemplate && (
          <div
            className="rounded-xl border border-warm-200 bg-warm-50/60"
            aria-label="Template preview"
          >
            <div className="border-b border-warm-200 px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Preview</p>
                <p className="text-[11px] text-muted/70">filled with sample lead</p>
              </div>
              <p className="mt-1 text-sm font-medium text-dark">
                {fillTemplateTags(selectedTemplate.subject || '') || '(no subject)'}
              </p>
            </div>
            <div className="whitespace-pre-line px-4 py-4 text-sm leading-7 text-dark">
              {stripPreviewHtml(fillTemplateTags(selectedTemplate.body || '')) || '(empty body)'}
            </div>
          </div>
        )}
      </section>

      {/* Audience filters */}
      <section className="surface-panel px-5 py-5">
        <h3 className="text-base font-semibold text-dark">Audience</h3>
        <div className="mt-3 rounded-2xl border border-warm-200 bg-warm-50/60 px-4 py-3.5 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => field('filterIsHiring', !form.filterIsHiring)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all whitespace-nowrap ${
                form.filterIsHiring
                  ? 'border-primary bg-primary text-warm-50'
                  : 'border-warm-300 bg-warm-50 text-muted hover:border-primary/40 hover:text-dark'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${form.filterIsHiring ? 'bg-warm-50/70' : 'bg-emerald-400'}`} />
              Hiring only
            </button>
            {([
              { value: REGION_US, label: 'US' },
              { value: REGION_INTL, label: 'International' },
              { value: REGION_REMOTE, label: 'Remote' },
            ] as const).map(({ value, label }) => {
              const active = form.filterRegion.includes(value)
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => field(
                    'filterRegion',
                    active
                      ? form.filterRegion.filter(r => r !== value)
                      : [...form.filterRegion, value],
                  )}
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all whitespace-nowrap ${
                    active
                      ? 'border-primary bg-primary text-warm-50'
                      : 'border-warm-300 bg-warm-50 text-muted hover:border-primary/40 hover:text-dark'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <div className="space-y-2.5 pt-0.5">
            {(options.stages || []).length > 0 && (
              <div className="flex items-start gap-3">
                <span className="w-16 shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/50">Stage</span>
                <div className="flex flex-wrap gap-1.5">
                  {(options.stages || []).map(stage => {
                    const active = form.filterStage.includes(stage)
                    return (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => field(
                          'filterStage',
                          active
                            ? form.filterStage.filter(s => s !== stage)
                            : [...form.filterStage, stage],
                        )}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                          active
                            ? 'border-primary bg-primary text-warm-50'
                            : 'border-warm-300 bg-warm-50 text-muted hover:border-primary/30 hover:text-dark'
                        }`}
                      >
                        {stage}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {CAMPAIGN_NS.map(ns => {
              const allTags = (options.tags?.[ns] || []).filter(t => t.count >= 15)
              if (allTags.length < 2) return null
              const expanded = expandedNs.has(ns)
              const selected = new Set(form.filterTags || [])
              // Pin selected tags into the visible set so a chip the user has
              // checked never disappears when its namespace is collapsed.
              // The "+ N more" count reflects truly hidden (unselected) tags.
              const visibleByCap = expanded ? allTags : allTags.slice(0, CHIP_VISIBLE_CAP)
              const extraSelected = expanded
                ? []
                : allTags.slice(CHIP_VISIBLE_CAP).filter(t => selected.has(t.namespaced))
              const tags = [...visibleByCap, ...extraSelected]
              const hidden = allTags.length - tags.length
              const toggleExpanded = () => setExpandedNs(prev => {
                const next = new Set(prev)
                if (next.has(ns)) next.delete(ns); else next.add(ns)
                return next
              })
              return (
                <div key={ns} className="flex items-start gap-3">
                  <span className="w-16 shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/50">
                    {NS_LABELS[ns]}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map(({ name, namespaced }) => (
                      <button
                        key={namespaced}
                        type="button"
                        onClick={() => toggleFilterTag(namespaced)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                          selected.has(namespaced)
                            ? 'border-primary bg-primary text-warm-50'
                            : 'border-warm-300 bg-warm-50 text-muted hover:border-primary/30 hover:text-dark'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                    {(hidden > 0 || expanded) && allTags.length > CHIP_VISIBLE_CAP && (
                      <button
                        type="button"
                        onClick={toggleExpanded}
                        className="text-[11px] font-medium text-muted hover:text-dark"
                        aria-expanded={expanded}
                      >
                        {expanded ? 'Show less' : `+ ${hidden} more`}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            {CAMPAIGN_NS.every(ns => !(options.tags?.[ns] || []).length) && (
              <p className="text-xs text-muted">Tags load once companies are ingested.</p>
            )}
          </div>
        </div>
      </section>

      {/* Batch + dedup */}
      <section className="surface-panel space-y-4 px-5 py-5">
        <h3 className="text-base font-semibold text-dark">Batching</h3>
        <div className="flex items-center gap-4">
          <div className="shrink-0">
            <label htmlFor="campaign-settings-batch-size" className="label">Batch size</label>
            <input
              id="campaign-settings-batch-size"
              type="number" min="1" max="50"
              value={form.batchSize}
              onChange={e => field('batchSize', e.target.value)}
              className="input w-24"
            />
          </div>
          <p className="mt-4 text-xs text-muted">
            Prospects per batch. Max 50.
          </p>
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-warm-200 bg-warm-50 px-3 py-2.5 transition-colors hover:border-primary/20 hover:bg-primary/5">
          <input
            type="checkbox"
            checked={form.includePreviouslySaved}
            onChange={e => field('includePreviouslySaved', e.target.checked)}
            className="mt-0.5 rounded border-warm-300"
          />
          <div>
            <p className="text-sm text-dark">Include leads saved in past campaigns</p>
            <p className="mt-0.5 text-xs text-muted">Off by default to avoid duplicates.</p>
          </div>
        </label>
      </section>

      {/* Default attachments - only render when the user has uploaded files */}
      {files.length > 0 && (
        <section className="surface-panel space-y-3 px-5 py-5">
          <div>
            <h3 className="text-base font-semibold text-dark">Default attachments</h3>
            <p className="mt-1 text-xs text-muted">Attached to new drafts in this campaign.</p>
          </div>
          <div className="space-y-1.5">
            {files.map(f => {
              const checked = (form.attachmentIds || []).includes(f.id)
              return (
                <label key={f.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-warm-200 bg-warm-50 px-3 py-2 transition-colors hover:border-primary/20 hover:bg-primary/5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => field('attachmentIds', checked
                      ? (form.attachmentIds || []).filter(id => id !== f.id)
                      : [...(form.attachmentIds || []), f.id]
                    )}
                    className="rounded border-warm-300"
                  />
                  <Filter size={11} className="shrink-0 text-muted" />
                  <span className="text-sm text-dark">{f.fileName}</span>
                </label>
              )
            })}
          </div>
        </section>
      )}

      {/* Danger zone */}
      <section className="surface-danger px-5 py-5">
        <h3 className="text-base font-semibold text-red-700">Danger zone</h3>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-dark">Delete this campaign</p>
            <p className="mt-0.5 text-xs text-muted">
              Saved prospects are not affected.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
            className="btn-danger text-xs shrink-0"
          >
            <Trash2 size={13} /> Delete campaign
          </button>
        </div>
      </section>

      {!form.name && (
        <Banner variant="warning" size="sm">Campaign name is required to save.</Banner>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={onDelete}
        title="Delete campaign"
        message={`"${campaign.name}" will be permanently deleted. This cannot be undone.`}
      />
    </div>
  )
}
