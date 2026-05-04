import React, { useState } from 'react'
import { ChevronRight, Filter } from 'lucide-react'
import Modal from '../ui/Modal'
import { REGION_INTL, REGION_REMOTE, REGION_US } from '../../types/audience'
import type { UiCampaign } from '../../contexts/AppDataContext'
import type { CampaignOptions, Template } from '../../types/api'

const CAMPAIGN_NS = ['stage', 'vertical', 'tech', 'model', 'investor', 'signal'] as const
const NS_LABELS: Record<string, string> = {
  stage: 'Stage', vertical: 'Sector', tech: 'Tech',
  model: 'Model', investor: 'Investor', signal: 'Signal',
}

export interface CampaignFormValue {
  name: string
  subject: string
  status: 'draft' | 'active' | 'paused' | 'completed'
  templateId: string
  filterTags: string[]
  filterRegion: string
  filterStage: string
  filterBatch: string
  filterIsHiring: boolean
  filterHeadcountMin: string
  filterHeadcountMax: string
  batchSize: string
  tone: string
  attachmentIds: string[]
}

export const INITIAL_FORM: CampaignFormValue = {
  name: '', subject: '', status: 'draft', templateId: '',
  filterTags: [], filterRegion: '', filterStage: '', filterBatch: '',
  filterIsHiring: false, filterHeadcountMin: '', filterHeadcountMax: '',
  batchSize: '10', tone: '', attachmentIds: [],
}

export function fromCampaign(c: UiCampaign): CampaignFormValue {
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
    tone: c.tone || '',
    attachmentIds: Array.isArray(c.attachmentIds) ? c.attachmentIds : [],
  }
}

function advancedSummary(form: CampaignFormValue): string {
  const parts: string[] = []
  if (form.filterBatch) parts.push(form.filterBatch)
  if (form.filterHeadcountMin || form.filterHeadcountMax) {
    parts.push(`${form.filterHeadcountMin || 0}–${form.filterHeadcountMax || '∞'} employees`)
  }
  if (form.tone) parts.push('tone set')
  return parts.join(', ')
}

interface CampaignFormModalProps {
  open: boolean
  editing: boolean
  initialForm: CampaignFormValue
  templates: Template[]
  options: CampaignOptions
  workspaceConfig: any
  saving: boolean
  onClose: () => void
  onSave: (form: CampaignFormValue) => void
}

export default function CampaignFormModal({
  open, editing, initialForm, templates, options, workspaceConfig, saving, onClose, onSave,
}: CampaignFormModalProps) {
  const [form, setForm] = useState<CampaignFormValue>(initialForm)
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(initialForm.filterBatch || initialForm.filterHeadcountMin || initialForm.filterHeadcountMax)
  )

  // Reset internal form when the parent reopens with a different campaign.
  React.useEffect(() => {
    if (open) {
      setForm(initialForm)
      setAdvancedOpen(Boolean(initialForm.filterBatch || initialForm.filterHeadcountMin || initialForm.filterHeadcountMax))
    }
  }, [open, initialForm])

  const field = <K extends keyof CampaignFormValue>(key: K, value: CampaignFormValue[K]) =>
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

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit campaign' : 'New campaign'} size="lg">
      <div className="px-6 py-5 space-y-6">
        {/* Basic info */}
        <div className="space-y-3">
          <div>
            <label className="label">Campaign name *</label>
            <input value={form.name} onChange={e => field('name', e.target.value)} placeholder="e.g. Spring 2026 YC outreach" className="input" required />
          </div>
          <div className={editing ? 'grid grid-cols-2 gap-3' : ''}>
            <div>
              <label className="label">Template</label>
              <select value={form.templateId} onChange={e => field('templateId', e.target.value)} className="select">
                <option value="">Select template...</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            {editing && (
              <div>
                <label className="label">Status</label>
                <select value={form.status} onChange={e => field('status', e.target.value as CampaignFormValue['status'])} className="select">
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Audience filters */}
        <div>
          <label className="label mb-2">Audience filters</label>
          <div className="rounded-2xl border border-warm-200 bg-warm-50/60 px-4 py-3.5 space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => field('filterIsHiring', !form.filterIsHiring)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all whitespace-nowrap ${
                  form.filterIsHiring
                    ? 'border-primary bg-primary text-white'
                    : 'border-warm-300 bg-white text-muted hover:border-primary/40 hover:text-dark'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${form.filterIsHiring ? 'bg-white/70' : 'bg-emerald-400'}`} />
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
                      ? 'border-primary bg-primary text-white'
                      : 'border-warm-300 bg-white text-muted hover:border-primary/40 hover:text-dark'
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
                              ? 'border-primary bg-primary text-white'
                              : 'border-warm-300 bg-white text-muted hover:border-primary/30 hover:text-dark'
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
        </div>

        {/* Default attachments */}
        {(workspaceConfig?.files || []).length > 0 && (
          <div>
            <label className="label">Default attachments</label>
            <p className="mb-2 text-xs text-muted">Files checked here will be attached to every email generated from this campaign.</p>
            <div className="space-y-1.5">
              {(workspaceConfig.files as Array<{ id: string; fileName: string; size: number }>).map(f => {
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
          </div>
        )}

        {/* Batch size */}
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
          <p className="mt-4 text-xs text-muted">Prospects pulled each time you click "Find matches" (max 50).</p>
        </div>

        {/* Advanced */}
        <div className="border-t border-warm-200 pt-4">
          <button
            type="button"
            onClick={() => setAdvancedOpen(o => !o)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted hover:text-dark transition-colors"
            aria-expanded={advancedOpen}
          >
            <ChevronRight size={12} className={`transition-transform ${advancedOpen ? 'rotate-90' : ''}`} />
            Advanced
            {!advancedOpen && advancedSummary(form) && (
              <span className="normal-case tracking-normal text-[11px] font-normal text-muted/70">— {advancedSummary(form)}</span>
            )}
          </button>

          {advancedOpen && (
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">YC Batch</label>
                  <select value={form.filterBatch} onChange={e => field('filterBatch', e.target.value)} className="select">
                    <option value="">Any batch</option>
                    {options.batches.map(v => <option key={v} value={v}>{v}</option>)}
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
              <div>
                <label className="label">Tone hint</label>
                <input
                  value={form.tone}
                  onChange={e => field('tone', e.target.value)}
                  placeholder="e.g. curious, low-key, technical"
                  className="input"
                />
                <p className="mt-1 text-xs text-muted">Shapes how generated emails sound. Leave blank to use your style profile.</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving || !form.name} className="btn-primary">
            {saving ? 'Saving...' : editing ? 'Save changes' : 'Create campaign'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
