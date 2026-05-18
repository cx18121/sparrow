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
import {
  DEFAULT_ROLE_FAMILY, labelForRoleFamily, type RoleFamily,
} from '../../types/roleFamilies'
import { RoleTiles } from '../ui/RoleTiles'
import type { CampaignOptions, Template } from '../../types/api'
import type { UiCampaign } from '../../contexts/AppDataContext'
import { PREVIEW_SAMPLE } from '../../lib/previewSample'

// CreateCampaignWizard - full-screen 4-step takeover replacing the modal-based
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

function fillTemplateTags(content: string) {
  if (!content) return ''
  return content
    .replace(/\{\{first_name\}\}/g, PREVIEW_SAMPLE.first_name)
    .replace(/\{\{firstName\}\}/g, PREVIEW_SAMPLE.first_name)
    .replace(/\{\{last_name\}\}/g, PREVIEW_SAMPLE.last_name)
    .replace(/\{\{lastName\}\}/g, PREVIEW_SAMPLE.last_name)
    .replace(/\{\{company\}\}/g, PREVIEW_SAMPLE.company)
    .replace(/\{\{company_name\}\}/g, PREVIEW_SAMPLE.company)
    .replace(/\{\{companyName\}\}/g, PREVIEW_SAMPLE.company)
    .replace(/\{\{role\}\}/g, PREVIEW_SAMPLE.role)
    .replace(/\{\{sender_name\}\}/g, PREVIEW_SAMPLE.sender_name)
    .replace(/\{\{senderName\}\}/g, PREVIEW_SAMPLE.sender_name)
    .replace(/\{\{feature_line\}\}/g, PREVIEW_SAMPLE.feature_line)
    .replace(/\{\{featureLine\}\}/g, PREVIEW_SAMPLE.feature_line)
    .replace(/\{\{fit_angle\}\}/g, PREVIEW_SAMPLE.fit_angle)
    .replace(/\{\{fitAngle\}\}/g, PREVIEW_SAMPLE.fit_angle)
}

// Strip HTML to readable plaintext for the preview pane. Mirrors the
// onboarding Step-2 preview's stripHtml — keeps paragraph breaks via \n\n
// so `whitespace-pre-line` renders the email as it would arrive in an inbox.
function stripPreviewHtml(content: string) {
  if (!content) return ''
  if (!content.includes('<')) return content
  if (typeof window !== 'undefined' && window.DOMParser) {
    const doc = new DOMParser().parseFromString(content, 'text/html')
    doc.body.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
    doc.body.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li').forEach(node => {
      node.appendChild(doc.createTextNode('\n\n'))
    })
    return (doc.body.textContent || '')
      .replace(/ /g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  return content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

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
  // User's default target role, set at onboarding / Settings. Used to render
  // the RolePicker's "currently in effect" label when the user hasn't picked
  // a per-campaign override yet. null → engineering applies at Apollo time.
  defaultTargetRole: RoleFamily | null
  onCancel: () => void
  onSubmit: (submission: WizardSubmission) => Promise<UiCampaign>
}

export default function CreateCampaignWizard({
  open, templates, options, saving, defaultTargetRole, onCancel, onSubmit,
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
    <div className="fixed inset-0 z-50 flex flex-col bg-surface animate-fade-in">
      {/* Sticky stepper */}
      <header className="sticky top-0 z-10 border-b border-warm-200 bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-dark transition-colors"
            aria-label="Cancel and close wizard"
          >
            <X size={14} /> Cancel
          </button>
          <ol className="hidden items-center gap-2 text-xs sm:flex">
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
                        ? 'border-primary bg-primary text-warm-50'
                        : done
                          ? 'border-primary/40 bg-primary/10 text-primary cursor-pointer hover:bg-primary/20'
                          : 'border-warm-300 bg-warm-50 text-muted/60'
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
          <div className="flex flex-1 items-center justify-end gap-1 sm:hidden">
            {STEPS.map((s, i) => (
              <button
                key={s.key}
                type="button"
                onClick={() => i < step && setStep(i)}
                disabled={i >= step}
                className={`h-2 rounded-full transition-all ${i === step ? 'w-8 bg-primary' : i < step ? 'w-4 bg-primary/45' : 'w-4 bg-warm-300'}`}
                aria-label={s.title}
              />
            ))}
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
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
              defaultTargetRole={defaultTargetRole}
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
      <footer className="sticky bottom-0 z-10 border-t border-warm-200 bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
        helper="Name the outreach work you want to run."
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
            className="rounded-full border border-warm-300 bg-warm-50 px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-primary/40 hover:text-dark"
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

// Signal tags hidden from the wizard's Signal row. multi-source is an
// internal data-quality signal (set by reconcile-company when a second
// ingest source touches the row); hn-hiring is too narrow a slice to
// surface as a primary filter; stage-inferred marks rows whose stage was
// heuristically derived from investor tags (auditable from the DB but
// not user-facing). They stay in Company.tags but the user no longer
// sees them as filter chips.
const HIDDEN_SIGNAL_TAGS = new Set(['signal:multi-source', 'signal:hn-hiring', 'signal:stage-inferred'])

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

// Per-namespace chip cap before the "+N more" expander shows. Set so the
// investor namespace (35 canonical slugs as of 2026-05-11) doesn't bury
// non-top-10 firms behind nothing — without an expander, .slice(0, N) makes
// investors past N unreachable from the wizard.
const CHIP_VISIBLE_CAP = 10

function StepFilters({
  audience, includePreviouslySaved, options, defaultTargetRole,
  onAudienceChange, onTogglePrev,
}: {
  audience: Audience
  includePreviouslySaved: boolean
  options: CampaignOptions
  defaultTargetRole: RoleFamily | null
  onAudienceChange: (a: Audience) => void
  onTogglePrev: (v: boolean) => void
}) {
  const [showAllBatches, setShowAllBatches] = useState(false)
  const [expandedNs, setExpandedNs] = useState<Set<string>>(() => new Set())

  const setRegion = (r: RegionFilter | null) =>
    onAudienceChange({ ...audience, region: audience.region === r ? null : r })

  const toggleTag = (namespaced: string) => {
    const has = audience.tags.includes(namespaced)
    let nextTags = has ? audience.tags.filter(t => t !== namespaced) : [...audience.tags, namespaced]
    // Clearing yc-backed must also clear the batch - otherwise a stale
    // batch keeps applying silently and the preview drops without a
    // visible reason.
    const next: Audience = { ...audience, tags: nextTags }
    if (namespaced === SIGNAL_YC && has) next.batch = null
    onAudienceChange(next)
  }

  const setBatch = (batch: string | null) =>
    onAudienceChange({ ...audience, batch: audience.batch === batch ? null : batch })

  const ycSelected = audience.tags.includes(SIGNAL_YC)
  const sortedBatches = useMemo(() => sortBatchesNewestFirst(options.batches || []), [options.batches])
  const visibleBatches = showAllBatches ? sortedBatches : sortedBatches.slice(0, 8)

  return (
    <section className="space-y-8">
      {/* Primary question: what role is the user looking for? Contact-side
          targeting, not a company-pool filter — sits above the audience block
          so the wizard reads role → companies → template → send. */}
      <RolePicker
        value={audience.targetRole}
        defaultValue={defaultTargetRole}
        onChange={role => onAudienceChange({ ...audience, targetRole: role })}
      />

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

          {(options.stages || []).length > 0 && (
            <FilterRow label="Stage">
              {(options.stages || []).map(stage => (
                <FilterChip
                  key={stage}
                  active={audience.stage === stage}
                  onClick={() => onAudienceChange({ ...audience, stage: audience.stage === stage ? null : stage })}
                >
                  {stage}
                </FilterChip>
              ))}
            </FilterRow>
          )}

          {SECTOR_NAMESPACES.map(ns => {
            const allTags = (options.tags?.[ns] || [])
              .filter(t => t.count >= 15 && !HIDDEN_SIGNAL_TAGS.has(t.namespaced))
            if (allTags.length < 2) return null
            const expanded = expandedNs.has(ns)
            const selected = new Set(audience.tags)
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
                  Off by default - Sparrow normally skips anyone you've already saved to avoid double-emailing.
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

  // Debounced query - re-issue 350ms after the audience changes.
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
    audience.isHiring,
    excludePreviouslySaved,
  ])

  const display = errored
    ? '-'
    : loading && count == null
      ? '…'
      : count == null
        ? '0'
        : `~${count}`

  return (
    <aside className="rounded-2xl border border-warm-200 bg-panel px-5 py-4 lg:sticky lg:top-24 self-start">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Audience preview</p>
      <p className="mt-3 font-display text-[2rem] font-semibold leading-none text-dark tabular-nums">
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
        helper="Choose the starting point for generated drafts."
      />
      <div className="mt-2 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-1.5">
          {templates.length === 0 && (
            <p className="rounded-2xl border border-dashed border-warm-300 bg-warm-50 px-4 py-6 text-xs text-muted">
              No saved templates yet. Skip this step or create one from Templates.
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
            <span className="text-xs text-muted">Draft from lead context.</span>
          </button>
        </div>

        {selected ? (
          <div className="rounded-xl border border-warm-200 bg-warm-50/60">
            <div className="border-b border-warm-200 px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Preview</p>
                <p className="text-[11px] text-muted/70">filled with sample lead</p>
              </div>
              <p className="mt-1 text-sm font-medium text-dark">{fillTemplateTags(selected.subject || '')}</p>
            </div>
            <div className="whitespace-pre-line px-4 py-4 text-sm leading-7 text-dark">
              {stripPreviewHtml(fillTemplateTags(selected.body || ''))}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-warm-200 bg-panel px-5 py-4">
            <p className="text-sm text-muted">
              {selectedId === null
                ? 'Each draft will start from lead context.'
                : 'Select a template on the left to preview it here.'}
            </p>
          </div>
        )}
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
        helper="Confirm the setup before launch."
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
            <em className="text-muted">No filters - Sparrow will sample broadly</em>
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

// Per-campaign role selector. Renders as a compact summary line until the
// user clicks "Change" — then expands to four tile-cards (one per family).
// `value` is the explicit per-campaign override (null = inherit). The
// summary line always shows what's currently in effect (override > default
// > engineering at apollo time), so users can see the live state without
// expanding the picker.
//
// Single-select by design: each campaign targets one role family. The
// email-generation strategy is going to fork on this value (step 6), and
// reasoning about "what kind of pitch is this campaign" gets harder with
// multiple roles in play.
function RolePicker({
  value, defaultValue, onChange,
}: {
  value: RoleFamily | null
  defaultValue: RoleFamily | null
  onChange: (next: RoleFamily | null) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // The role rendered in the summary line — the explicit override if set,
  // otherwise the user's workspace default, otherwise the registry default.
  // Mirrors the resolution order in apollo.ts:resolveTargetTitles so the UI
  // never lies about what Apollo will actually query.
  const effective: RoleFamily = value ?? defaultValue ?? DEFAULT_ROLE_FAMILY
  const overrideActive = value !== null && value !== defaultValue
  // Picking the role that matches the inherited default clears the override
  // instead of pinning it explicitly — keeps the campaign in "inherit" mode
  // so a later Settings change still propagates here.
  const handlePick = (next: RoleFamily) => {
    if (defaultValue !== null && next === defaultValue) {
      onChange(null)
    } else {
      onChange(next)
    }
    setExpanded(false)
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Users size={16} />
        </div>
        <div>
          <p className="page-eyebrow">Start with</p>
          <h2 className="mt-1 font-display text-[1.35rem] font-semibold leading-tight text-dark">
            What role are you looking for?
          </h2>
        </div>
      </div>

      {!expanded && (
        <div className="ml-12 flex items-start justify-between gap-4">
          <p className="text-[14px] text-dark">
            <span className="font-medium text-primary">{labelForRoleFamily(effective)}</span>
            {overrideActive && (
              <span className="ml-2 text-[11px] text-muted">(overrides your default)</span>
            )}
          </p>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="shrink-0 text-[11px] font-semibold text-primary hover:underline"
          >
            Change
          </button>
        </div>
      )}

      {expanded && (
        <div className="ml-12 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/60">
              Pick one
            </p>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-[11px] font-medium text-muted hover:text-dark"
            >
              Done
            </button>
          </div>
          <RoleTiles value={effective} onChange={handlePick} />
        </div>
      )}
    </div>
  )
}

function StepHeader({
  icon: Icon, title, helper,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  helper?: string
}) {
  return (
    <div className="mb-6 flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon size={16} />
      </div>
      <div>
        <h2 className="font-display text-2xl font-semibold text-dark">{title}</h2>
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
          ? 'border-primary bg-primary text-warm-50'
          : 'border-warm-300 bg-warm-50 text-muted hover:border-primary/40 hover:text-dark'
      }`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-warm-50/70' : 'bg-emerald-400'}`} />}
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

// Public helper - converts a wizard submission to the shape `createCampaign`
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
