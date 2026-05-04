import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { Filter, Trash2 } from 'lucide-react'
import Banner from '../ui/Banner'
import ConfirmDialog from '../ui/ConfirmDialog'
import Toast from '../ui/Toast'
import { fetchCampaignOptions } from '../../lib/api'
import { useAppData, type UiCampaign } from '../../contexts/AppDataContext'
import { REGION_INTL, REGION_REMOTE, REGION_US } from '../../types/audience'
import type { CampaignOptions } from '../../types/api'
import type { WorkspaceOutletContext } from './WorkspaceShell'

// Phase 4d: inline campaign editor that replaces CampaignFormModal in the
// workspace. Same field set minus `tone` (dropped per redesign) and minus the
// status select for "create" mode (this surface only edits an existing
// campaign). Save is gated on dirty state; a danger-zone Delete sits at the
// bottom and pushes back to /dashboard on success.

const CAMPAIGN_NS = ['stage', 'vertical', 'tech', 'model', 'investor', 'signal'] as const
const NS_LABELS: Record<string, string> = {
  stage: 'Stage', vertical: 'Sector', tech: 'Tech',
  model: 'Model', investor: 'Investor', signal: 'Signal',
}

interface FormValue {
  name: string
  subject: string
  status: 'active' | 'paused' | 'completed'
  templateId: string
  filterTags: string[]
  filterRegion: string
  filterStage: string
  filterBatch: string
  filterIsHiring: boolean
  filterHeadcountMin: string
  filterHeadcountMax: string
  batchSize: string
  attachmentIds: string[]
  includePreviouslySaved: boolean
}

function fromCampaign(c: UiCampaign): FormValue {
  return {
    name: c.name,
    subject: c.subject || '',
    status: c.status,
    templateId: c.templateId || '',
    filterTags: c.filterTags || [],
    filterRegion: c.filterRegion || '',
    filterStage: c.filterStage || '',
    filterBatch: c.filterBatch || '',
    filterIsHiring: c.filterIsHiring === true,
    filterHeadcountMin: c.filterHeadcountMin != null ? String(c.filterHeadcountMin) : '',
    filterHeadcountMax: c.filterHeadcountMax != null ? String(c.filterHeadcountMax) : '',
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
  const [toast, setToast] = useState<{ type: 'error' | 'success'; title: string; message?: string } | null>(null)

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
        filterRegion: form.filterRegion || null,
        filterStage: form.filterStage || null,
        filterBatch: form.filterBatch || null,
        filterIsHiring: form.filterIsHiring || null,
        filterHeadcountMin: form.filterHeadcountMin ? Number(form.filterHeadcountMin) : null,
        filterHeadcountMax: form.filterHeadcountMax ? Number(form.filterHeadcountMax) : null,
        batchSize: Number(form.batchSize) || 10,
        attachmentIds: form.attachmentIds || [],
        includePreviouslySaved: form.includePreviouslySaved,
      })
      setToast({ type: 'success', title: 'Saved' })
    } catch (err) {
      setToast({ type: 'error', title: 'Could not save', message: (err as Error)?.message })
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
      setToast({ type: 'error', title: 'Could not delete campaign', message: (err as Error)?.message })
    }
  }

  const files = (workspaceConfig?.files || []) as Array<{ id: string; fileName: string; size: number }>

  return (
    <div className="space-y-6">
      <Toast toast={toast} onClose={() => setToast(null)} />

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
          <label className="label">Campaign name *</label>
          <input
            value={form.name}
            onChange={e => field('name', e.target.value)}
            className="input"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Template</label>
            <select value={form.templateId} onChange={e => field('templateId', e.target.value)} className="select">
              <option value="">Select template…</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select
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
            ] as const).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => field('filterRegion', form.filterRegion === value ? '' : value)}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all whitespace-nowrap ${
                  form.filterRegion === value
                    ? 'border-primary bg-primary text-warm-50'
                    : 'border-warm-300 bg-warm-50 text-muted hover:border-primary/40 hover:text-dark'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-2.5 pt-0.5">
            {CAMPAIGN_NS.map(ns => {
              const tags = (options.tags?.[ns] || []).filter(t => t.count >= 15).slice(0, 8)
              if (tags.length < 2) return null
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
                          (form.filterTags || []).includes(namespaced)
                            ? 'border-primary bg-primary text-warm-50'
                            : 'border-warm-300 bg-warm-50 text-muted hover:border-primary/30 hover:text-dark'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
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
            <label className="label">Batch size</label>
            <input
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
      <section className="rounded-2xl border border-red-200 bg-red-50/50 px-5 py-5">
        <h3 className="text-base font-semibold text-red-900">Danger zone</h3>
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
