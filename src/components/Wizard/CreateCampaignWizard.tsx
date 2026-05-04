import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, ChevronRight, FileText, Filter,
  Sparkles, Users, X,
} from 'lucide-react'
import { queryAudience } from '../../lib/api'
import {
  EMPTY_AUDIENCE, REGION_INTL, REGION_REMOTE, REGION_US,
  audienceToCampaignFields, audienceToDisplayPills, type Audience, type RegionFilter,
} from '../../types/audience'
import type { CampaignOptions, Template } from '../../types/api'
import type { UiCampaign } from '../../contexts/AppDataContext'

// CreateCampaignWizard — full-screen 4-step takeover replacing the modal-based
// CampaignFormModal on the Home surface. The other modal callsite
// (CampaignsTab editing flow) stays untouched until Phase 4.
//
// Steps: Name · Filters · Template · Review.
// Sticky stepper across the top, sticky Cancel · Continue → footer.
// Local-storage scratch state per step so a refresh doesn't lose work.

const STORAGE_KEY = 'sparrow_wizard_v1'

const NAME_SUGGESTIONS = [
  'Spring 2026 outreach',
  'YC W26 hiring',
  'Series A AI infra',
  'Climate-tech founders',
]

const SECTOR_NAMESPACES = ['vertical', 'tech', 'model', 'investor', 'signal'] as const
const NS_LABEL: Record<string, string> = {
  vertical: 'Sector',
  tech: 'Tech',
  model: 'Model',
  investor: 'Investor',
  signal: 'Signal',
  stage: 'Stage',
}

export interface WizardSubmission {
  name: string
  audience: Audience
  templateId: string | null
  status: 'active' | 'paused'
  includePreviouslySaved: boolean
  batchSize: number
}

interface ScratchState {
  name: string
  audience: Audience
  templateId: string | null
  includePreviouslySaved: boolean
  batchSize: number
  step: number
}

const EMPTY_SCRATCH: ScratchState = {
  name: '',
  audience: { ...EMPTY_AUDIENCE },
  templateId: null,
  includePreviouslySaved: false,
  batchSize: 10,
  step: 0,
}

function loadScratch(): ScratchState {
  if (typeof window === 'undefined') return EMPTY_SCRATCH
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_SCRATCH
    const parsed = JSON.parse(raw)
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      audience: { ...EMPTY_AUDIENCE, ...(parsed.audience || {}) },
      templateId: typeof parsed.templateId === 'string' ? parsed.templateId : null,
      includePreviouslySaved: Boolean(parsed.includePreviouslySaved),
      batchSize: Number.isFinite(parsed.batchSize) ? parsed.batchSize : 10,
      step: Number.isFinite(parsed.step) ? Math.min(Math.max(parsed.step, 0), 3) : 0,
    }
  } catch {
    return EMPTY_SCRATCH
  }
}

function persistScratch(state: ScratchState) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

function clearScratch() {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(STORAGE_KEY) } catch {}
}

const STEPS = [
  { key: 'name', title: 'Name', helper: 'Give the campaign a memorable name' },
  { key: 'filters', title: 'Filters', helper: 'Narrow who Sparrow finds for you' },
  { key: 'template', title: 'Template', helper: 'Pick a starting point for emails' },
  { key: 'review', title: 'Review', helper: 'Confirm and launch' },
] as const

interface WizardProps {
  open: boolean
  templates: Template[]
  options: CampaignOptions
  saving: boolean
  onCancel: () => void
  onSubmit: (submission: WizardSubmission) => Promise<UiCampaign>
}

export default function CreateCampaignWizard({
  open, templates, options, saving, onCancel, onSubmit,
}: WizardProps) {
  const [state, setState] = useState<ScratchState>(EMPTY_SCRATCH)
  const [hydrated, setHydrated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitChoice, setSubmitChoice] = useState<'active' | 'paused' | null>(null)

  // Hydrate from localStorage on open. Reset everything when the wizard closes
  // so the next open isn't haunted by an in-flight submission's state.
  useEffect(() => {
    if (open) {
      setState(loadScratch())
      setError(null)
      setSubmitChoice(null)
      setHydrated(true)
    } else {
      setHydrated(false)
    }
  }, [open])

  useEffect(() => {
    if (hydrated) persistScratch(state)
  }, [state, hydrated])

  if (!open) return null

  const step = state.step
  const setStep = (next: number) => setState(s => ({ ...s, step: Math.min(Math.max(next, 0), 3) }))

  const canContinue = (() => {
    if (step === 0) return state.name.trim().length > 0
    return true
  })()

  const goNext = () => {
    if (!canContinue) return
    if (step < 3) setStep(step + 1)
  }
  const goBack = () => { if (step > 0) setStep(step - 1) }

  const handleCancel = () => {
    clearScratch()
    onCancel()
  }

  const submit = async (status: 'active' | 'paused') => {
    setError(null)
    setSubmitChoice(status)
    try {
      await onSubmit({
        name: state.name.trim(),
        audience: state.audience,
        templateId: state.templateId,
        status,
        includePreviouslySaved: state.includePreviouslySaved,
        batchSize: state.batchSize,
      })
      clearScratch()
    } catch (err: any) {
      setError(err?.message || 'Could not create campaign. Try again.')
      setSubmitChoice(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-warm-50 animate-fade-in">
      {/* Sticky stepper */}
      <header className="sticky top-0 z-10 border-b border-warm-200 bg-warm-50/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-dark transition-colors"
            aria-label="Cancel and close wizard"
          >
            <X size={14} /> Cancel
          </button>
          <ol className="flex items-center gap-2 text-xs">
            {STEPS.map((s, i) => {
              const active = i === step
              const done = i < step
              return (
                <li key={s.key} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => done && setStep(i)}
                    disabled={!done}
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors ${
                      active
                        ? 'border-primary bg-primary text-white'
                        : done
                          ? 'border-primary/40 bg-primary/10 text-primary cursor-pointer hover:bg-primary/20'
                          : 'border-warm-300 bg-white text-muted/60'
                    }`}
                    aria-current={active ? 'step' : undefined}
                  >
                    {done ? <Check size={11} /> : i + 1}
                  </button>
                  <span className={active ? 'font-medium text-dark' : 'text-muted'}>
                    {s.title}
                  </span>
                  {i < STEPS.length - 1 && (
                    <ChevronRight size={12} className="text-muted/40" />
                  )}
                </li>
              )
            })}
          </ol>
          <span className="w-[68px]" aria-hidden />
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-10">
          {step === 0 && (
            <StepName
              value={state.name}
              onChange={name => setState(s => ({ ...s, name }))}
              onAdvance={goNext}
            />
          )}
          {step === 1 && (
            <StepFilters
              audience={state.audience}
              includePreviouslySaved={state.includePreviouslySaved}
              options={options}
              onAudienceChange={audience => setState(s => ({ ...s, audience }))}
              onTogglePrev={includePreviouslySaved => setState(s => ({ ...s, includePreviouslySaved }))}
            />
          )}
          {step === 2 && (
            <StepTemplate
              templates={templates}
              selectedId={state.templateId}
              onSelect={templateId => setState(s => ({ ...s, templateId }))}
            />
          )}
          {step === 3 && (
            <StepReview
              state={state}
              templates={templates}
              onJumpTo={setStep}
            />
          )}
        </div>
      </main>

      {/* Sticky footer */}
      <footer className="sticky bottom-0 z-10 border-t border-warm-200 bg-warm-50/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-3.5">
          <button
            type="button"
            onClick={step === 0 ? handleCancel : goBack}
            className="btn-secondary"
            disabled={saving}
          >
            <ArrowLeft size={14} /> {step === 0 ? 'Cancel' : 'Back'}
          </button>

          {error && (
            <p className="flex-1 text-center text-xs text-red-700" role="alert">{error}</p>
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canContinue}
              className="btn-primary"
            >
              Continue <ArrowRight size={14} />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => submit('paused')}
                disabled={saving}
                className="btn-secondary"
              >
                {saving && submitChoice === 'paused' ? 'Saving…' : 'Save as Paused'}
              </button>
              <button
                type="button"
                onClick={() => submit('active')}
                disabled={saving}
                className="btn-primary"
              >
                {saving && submitChoice === 'active' ? 'Launching…' : 'Launch (Active)'}
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  )
}

// ---------- Step 1: Name ----------

function StepName({
  value, onChange, onAdvance,
}: {
  value: string
  onChange: (v: string) => void
  onAdvance: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  return (
    <section className="mx-auto max-w-xl">
      <StepHeader
        icon={Sparkles}
        title="Name your campaign"
        helper="A campaign is one outreach project — its own audience, template, and lead pool."
      />
      <input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && value.trim()) onAdvance() }}
        placeholder="e.g. Spring 2026 YC outreach"
        className="input mt-2 text-base"
        aria-label="Campaign name"
      />
      <p className="mt-3 text-xs text-muted">Try one of these</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {NAME_SUGGESTIONS.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className="rounded-full border border-warm-300 bg-white px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-dark"
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  )
}

// ---------- Step 2: Filters ----------

const SIGNAL_YC = 'signal:yc-backed'

// Headcount buckets used by the size chips. Each chip writes a (min, max)
// pair into the audience; clicking the active chip clears both. Buckets
// match how students mentally segment company size, not raw deciles.
const SIZE_BUCKETS: ReadonlyArray<{ key: string; label: string; min: number | null; max: number | null }> = [
  { key: 'tiny',  label: 'Tiny · <10',     min: null, max: 9 },
  { key: 'small', label: 'Small · 10–50',  min: 10,   max: 50 },
  { key: 'mid',   label: 'Mid · 50–250',   min: 50,   max: 250 },
  { key: 'large', label: 'Large · 250+',   min: 250,  max: null },
]

function activeSizeBucket(audience: Audience): string | null {
  const match = SIZE_BUCKETS.find(b => b.min === audience.headcountMin && b.max === audience.headcountMax)
  return match ? match.key : null
}

// Sorts YC batch strings newest-first. Handles both compact ("W26", "S25",
// "F24") and long ("Winter 2026", "Summer 2025") forms by extracting the
// year and a season ordinal. "Unspecified" sinks to the bottom.
function sortBatchesNewestFirst(batches: string[]): string[] {
  const seasonRank: Record<string, number> = { W: 0, X: 1, S: 2, F: 3, winter: 0, spring: 1, summer: 2, fall: 3 }
  const score = (raw: string): number => {
    if (/^unspecified$/i.test(raw)) return -Infinity
    const compact = raw.match(/^([WSFX])(\d{2})$/i)
    if (compact) {
      const year = 2000 + parseInt(compact[2], 10)
      return year * 10 + (3 - (seasonRank[compact[1].toUpperCase()] ?? 0))
    }
    const long = raw.match(/(winter|spring|summer|fall)\s+(\d{4})/i)
    if (long) return parseInt(long[2], 10) * 10 + (3 - (seasonRank[long[1].toLowerCase()] ?? 0))
    return 0
  }
  return [...batches].sort((a, b) => score(b) - score(a))
}

function StepFilters({
  audience, includePreviouslySaved, options,
  onAudienceChange, onTogglePrev,
}: {
  audience: Audience
  includePreviouslySaved: boolean
  options: CampaignOptions
  onAudienceChange: (a: Audience) => void
  onTogglePrev: (v: boolean) => void
}) {
  const [showAllBatches, setShowAllBatches] = useState(false)

  const setRegion = (r: RegionFilter | null) =>
    onAudienceChange({ ...audience, region: audience.region === r ? null : r })

  const toggleTag = (namespaced: string) => {
    const has = audience.tags.includes(namespaced)
    let nextTags = has ? audience.tags.filter(t => t !== namespaced) : [...audience.tags, namespaced]
    // Clearing yc-backed must also clear the batch — otherwise a stale
    // batch keeps applying silently and the preview drops without a
    // visible reason.
    const next: Audience = { ...audience, tags: nextTags }
    if (namespaced === SIGNAL_YC && has) next.batch = null
    onAudienceChange(next)
  }

  const setBatch = (batch: string | null) =>
    onAudienceChange({ ...audience, batch: audience.batch === batch ? null : batch })

  const setSize = (key: string) => {
    if (activeSizeBucket(audience) === key) {
      onAudienceChange({ ...audience, headcountMin: null, headcountMax: null })
      return
    }
    const bucket = SIZE_BUCKETS.find(b => b.key === key)
    if (!bucket) return
    onAudienceChange({ ...audience, headcountMin: bucket.min, headcountMax: bucket.max })
  }

  const ycSelected = audience.tags.includes(SIGNAL_YC)
  const sortedBatches = useMemo(() => sortBatchesNewestFirst(options.batches || []), [options.batches])
  const visibleBatches = showAllBatches ? sortedBatches : sortedBatches.slice(0, 8)
  const sizeKey = activeSizeBucket(audience)

  return (
    <section>
      <StepHeader
        icon={Filter}
        title="Who should Sparrow find?"
      />
      <div className="mt-2 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Filter pills */}
        <div className="space-y-5">
          <FilterRow label="Region">
            <FilterChip active={audience.region === REGION_US} onClick={() => setRegion(REGION_US)}>US</FilterChip>
            <FilterChip active={audience.region === REGION_INTL} onClick={() => setRegion(REGION_INTL)}>International</FilterChip>
            <FilterChip active={audience.region === REGION_REMOTE} onClick={() => setRegion(REGION_REMOTE)}>Remote</FilterChip>
          </FilterRow>

          <FilterRow label="Hiring">
            <FilterChip
              active={audience.isHiring === true}
              onClick={() => onAudienceChange({ ...audience, isHiring: audience.isHiring ? null : true })}
              dot
            >
              Currently hiring
            </FilterChip>
          </FilterRow>

          <FilterRow label="Size">
            {SIZE_BUCKETS.map(b => (
              <FilterChip
                key={b.key}
                active={sizeKey === b.key}
                onClick={() => setSize(b.key)}
              >
                {b.label}
              </FilterChip>
            ))}
            {sizeKey && (
              <span className="self-center pl-1 text-[11px] text-muted/80">
                Only matches companies with known headcount
              </span>
            )}
          </FilterRow>

          {SECTOR_NAMESPACES.map(ns => {
            const tags = (options.tags?.[ns] || []).filter(t => t.count >= 15).slice(0, 8)
            if (tags.length < 2) return null
            const showBatchPicker = ns === 'signal' && ycSelected && sortedBatches.length > 0
            return (
              <div key={ns}>
                <FilterRow label={NS_LABEL[ns] || ns}>
                  {tags.map(t => (
                    <FilterChip
                      key={t.namespaced}
                      active={audience.tags.includes(t.namespaced)}
                      onClick={() => toggleTag(t.namespaced)}
                    >
                      {t.name}
                    </FilterChip>
                  ))}
                </FilterRow>
                {showBatchPicker && (
                  <div className="mt-2 ml-[76px] flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/60">
                      Batch
                    </span>
                    <FilterChip active={!audience.batch} onClick={() => setBatch(null)}>
                      Any
                    </FilterChip>
                    {visibleBatches.map(b => (
                      <FilterChip key={b} active={audience.batch === b} onClick={() => setBatch(b)}>
                        {b}
                      </FilterChip>
                    ))}
                    {!showAllBatches && sortedBatches.length > 8 && (
                      <button
                        type="button"
                        onClick={() => setShowAllBatches(true)}
                        className="text-[11px] font-medium text-muted hover:text-dark"
                      >
                        + {sortedBatches.length - 8} more
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          <div className="border-t border-warm-200 pt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includePreviouslySaved}
                onChange={e => onTogglePrev(e.target.checked)}
                className="mt-1 rounded border-warm-300"
              />
              <span>
                <span className="block text-sm font-medium text-dark">
                  Include leads I've already saved in past campaigns
                </span>
                <span className="block text-xs text-muted">
                  Off by default — Sparrow normally skips anyone you've already saved to avoid double-emailing.
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* Live audience preview */}
        <AudiencePreview
          audience={audience}
          excludePreviouslySaved={!includePreviouslySaved}
        />
      </div>
    </section>
  )
}

function AudiencePreview({
  audience, excludePreviouslySaved,
}: {
  audience: Audience
  excludePreviouslySaved: boolean
}) {
  const [count, setCount] = useState<number | null>(null)
  const [sample, setSample] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [errored, setErrored] = useState(false)

  // Debounced query — re-issue 350ms after the audience changes.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErrored(false)
    const handle = window.setTimeout(() => {
      queryAudience(audience, excludePreviouslySaved)
        .then(res => {
          if (cancelled) return
          setCount(res.count)
          setSample(res.sample)
          setLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          setErrored(true)
          setLoading(false)
        })
    }, 350)
    return () => { cancelled = true; window.clearTimeout(handle) }
  }, [
    audience.tags.join(','), audience.region, audience.stage, audience.batch,
    audience.isHiring, audience.headcountMin, audience.headcountMax,
    excludePreviouslySaved,
  ])

  const display = errored
    ? '—'
    : loading && count == null
      ? '…'
      : count == null
        ? '0'
        : `~${count}`

  return (
    <aside className="rounded-2xl border border-warm-200 bg-panel px-5 py-4 lg:sticky lg:top-24 self-start">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Audience preview</p>
      <p className="mt-3 font-display text-[2rem] font-semibold leading-none tracking-[-0.03em] text-dark tabular-nums">
        {display}
      </p>
      <p className="mt-1 text-xs text-muted">
        {errored ? 'Could not load preview' : count === 1 ? 'company matches' : 'companies match'}
      </p>
      <p className="mt-3 text-[11px] leading-5 text-muted/70">
        Live count from the verified company pool
        {excludePreviouslySaved ? ', minus anyone you already saved' : ''}.
      </p>
      {sample.length > 0 && (
        <>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Sample</p>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {sample.map(name => (
              <li key={name} className="truncate">{name}</li>
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}

// ---------- Step 3: Template ----------

function StepTemplate({
  templates, selectedId, onSelect,
}: {
  templates: Template[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const selected = templates.find(t => t.id === selectedId) || null

  return (
    <section>
      <StepHeader
        icon={FileText}
        title="Pick a template"
        helper="Sparrow uses this as the starting point for every email it generates."
      />
      <div className="mt-2 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-1.5">
          {templates.length === 0 && (
            <p className="rounded-2xl border border-dashed border-warm-300 bg-warm-50 px-4 py-6 text-xs text-muted">
              No saved templates yet. Skip below to let Sparrow draft each email from scratch, or add a template from Templates first.
            </p>
          )}
          {templates.map(t => {
            const active = t.id === selectedId
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(t.id)}
                className={`flex w-full flex-col gap-1 rounded-2xl border px-4 py-3 text-left transition-colors ${
                  active
                    ? 'border-primary bg-primary/5'
                    : 'border-warm-200 bg-panel hover:border-primary/30'
                }`}
              >
                <span className={`text-sm font-medium ${active ? 'text-dark' : 'text-dark'}`}>{t.name}</span>
                {t.subject && <span className="line-clamp-1 text-xs text-muted">{t.subject}</span>}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`mt-1 flex w-full flex-col items-start gap-0.5 rounded-2xl border px-4 py-3 text-left transition-colors ${
              selectedId === null
                ? 'border-primary bg-primary/5'
                : 'border-dashed border-warm-300 bg-warm-50 hover:border-primary/30'
            }`}
          >
            <span className="text-sm font-medium text-dark">No template</span>
            <span className="text-xs text-muted">Sparrow drafts each email fresh from the lead's context.</span>
          </button>
        </div>

        <div className="rounded-2xl border border-warm-200 bg-panel px-5 py-4">
          {selected ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Preview</p>
              <p className="mt-3 text-sm font-medium text-dark">Subject: {selected.subject}</p>
              <div
                className="prose prose-sm mt-3 max-w-none text-sm text-dark"
                dangerouslySetInnerHTML={{ __html: selected.body }}
              />
            </>
          ) : (
            <p className="text-sm text-muted">
              {selectedId === null
                ? 'Without a template, Sparrow drafts each email from the lead\'s company context — no shared subject or skeleton to keep edits aligned to.'
                : 'Select a template on the left to preview it here.'}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

// ---------- Step 4: Review ----------

function StepReview({
  state, templates, onJumpTo,
}: {
  state: ScratchState
  templates: Template[]
  onJumpTo: (step: number) => void
}) {
  const template = templates.find(t => t.id === state.templateId) || null
  const audiencePills = audienceToDisplayPills(state.audience)

  return (
    <section className="mx-auto max-w-2xl">
      <StepHeader
        icon={Users}
        title="Review and launch"
        helper="One last look before Sparrow starts working on it."
      />
      <dl className="mt-2 divide-y divide-warm-200 rounded-2xl border border-warm-200 bg-panel">
        <ReviewRow label="Name" onEdit={() => onJumpTo(0)}>
          <span className="font-medium text-dark">{state.name || <em className="text-muted">Unnamed</em>}</span>
        </ReviewRow>
        <ReviewRow label="Audience" onEdit={() => onJumpTo(1)}>
          {audiencePills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {audiencePills.map(p => (
                <span key={p} className="rounded-full bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-primary">
                  {p}
                </span>
              ))}
            </div>
          ) : (
            <em className="text-muted">No filters — Sparrow will sample broadly</em>
          )}
          <p className="mt-1.5 text-xs text-muted">
            {state.includePreviouslySaved
              ? 'Including leads from past campaigns'
              : 'Skipping leads from past campaigns'}
          </p>
        </ReviewRow>
        <ReviewRow label="Template" onEdit={() => onJumpTo(2)}>
          {template ? (
            <span className="font-medium text-dark">{template.name}</span>
          ) : (
            <em className="text-muted">Write from scratch</em>
          )}
        </ReviewRow>
      </dl>
    </section>
  )
}

// ---------- Shared bits ----------

function StepHeader({
  icon: Icon, title, helper,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  helper?: string
}) {
  return (
    <div className="mb-6 flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon size={16} />
      </div>
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-dark">{title}</h2>
        {helper && <p className="mt-1 text-sm text-muted">{helper}</p>}
      </div>
    </div>
  )
}

function FilterRow({
  label, children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-16 shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/60">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function FilterChip({
  active, onClick, dot, children,
}: {
  active: boolean
  onClick: () => void
  dot?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all whitespace-nowrap ${
        active
          ? 'border-primary bg-primary text-white'
          : 'border-warm-300 bg-white text-muted hover:border-primary/40 hover:text-dark'
      }`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-white/70' : 'bg-emerald-400'}`} />}
      {children}
    </button>
  )
}

function ReviewRow({
  label, children, onEdit,
}: {
  label: string
  children: React.ReactNode
  onEdit: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/70">{label}</dt>
        <dd className="mt-1.5 text-sm text-dark">{children}</dd>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="text-xs font-medium text-primary hover:underline"
      >
        Edit
      </button>
    </div>
  )
}

// Public helper — converts a wizard submission to the shape `createCampaign`
// already accepts. Lives here so the Home page doesn't need to know the
// audience-field mapping.
export function submissionToCampaignPayload(s: WizardSubmission): Partial<UiCampaign> {
  return {
    name: s.name,
    subject: null,
    status: s.status,
    templateId: s.templateId,
    batchSize: s.batchSize,
    includePreviouslySaved: s.includePreviouslySaved,
    attachmentIds: [],
    ...audienceToCampaignFields(s.audience),
  }
}

// Re-export so the spec can target the storage key without importing internals.
export { STORAGE_KEY as WIZARD_STORAGE_KEY }
