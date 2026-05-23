import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Check, ChevronRight, X } from 'lucide-react'
import {
  EMPTY_AUDIENCE,
  audienceToCampaignFields, type Audience,
} from '../../types/audience'
import { type RoleFamily } from '../../types/roleFamilies'
import type { CampaignOptions, Template } from '../../types/api'
import type { UiCampaign } from '../../contexts/AppDataContext'
import StepName from './steps/StepName'
import StepFilters from './steps/StepFilters'
import StepTemplate from './steps/StepTemplate'
import StepReview from './steps/StepReview'

// CreateCampaignWizard - full-screen 4-step takeover replacing the
// modal-based CampaignFormModal on the Home surface. The other modal
// callsite (CampaignsTab editing flow) stays untouched until Phase 4.
//
// Steps: Name · Filters · Template · Review.
// Sticky stepper across the top, sticky Cancel · Continue → footer.
// Local-storage scratch state per step so a refresh doesn't lose work.
//
// Step implementations live in steps/. Shared layout primitives
// (StepHeader, FilterRow, FilterChip) live in _shared.tsx.

const STORAGE_KEY = 'sparrow_wizard_v1'

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

// Coerce a possibly-legacy audience filter field (scalar or array) to
// the current array shape. Pre-multi-select scratch state in
// localStorage stored region/stage/batch as `string | null`; ignoring
// that would let `null` overwrite EMPTY_AUDIENCE's `[]` and crash the
// wizard on first render.
function coerceAudienceArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function loadScratch(): ScratchState {
  if (typeof window === 'undefined') return EMPTY_SCRATCH
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_SCRATCH
    const parsed = JSON.parse(raw)
    const rawAudience = parsed.audience || {}
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      audience: {
        ...EMPTY_AUDIENCE,
        ...rawAudience,
        region: coerceAudienceArray(rawAudience.region),
        stage: coerceAudienceArray(rawAudience.stage),
        batch: coerceAudienceArray(rawAudience.batch),
      },
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
  // User's default target role, set at onboarding / Settings. Used to
  // render the RolePicker's "currently in effect" label when the user
  // hasn't picked a per-campaign override yet. null → engineering
  // applies at Apollo time.
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
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // Hydrate from localStorage on open. Reset everything when the
  // wizard closes so the next open isn't haunted by an in-flight
  // submission's state.
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

  // Escape dismisses the wizard. Suppressed during submit so a stray
  // key press can't drop the user out mid-create. Both flags matter:
  // `submitChoice` is set synchronously when the user clicks Create,
  // and `saving` flips when the parent's request actually starts —
  // there's a brief window where submitChoice is truthy but saving is
  // still false, and Escape during that gap would abort an in-flight
  // create.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && submitChoice === null) {
        clearScratch()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, saving, submitChoice, onCancel])

  // Tab trap: the wizard is full-screen but rendered in a portal, so
  // without this Tab can still reach focusables in the underlying
  // page (sidebar, home content). Wrap Tab from the last focusable
  // back to the first (and Shift+Tab from first to last). Step-level
  // focus is owned by each step's own effect — we only intervene at
  // the boundaries.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter(el => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true')
      if (focusable.length === 0) {
        e.preventDefault()
        root.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null
      const insideDialog = active ? root.contains(active) : false
      if (!insideDialog) {
        e.preventDefault()
        first.focus()
        return
      }
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

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

  // Portal the wizard to document.body so its `fixed inset-0 z-50`
  // doesn't get trapped inside <main>'s stacking context. AppShell
  // renders <main className="relative z-10">, which creates a
  // stacking context that contains everything inside it — including
  // a z-50 child — beneath the sidebar's z-20 layer at the outer
  // flex level. Portaling escapes that context and lets the overlay
  // actually cover the sidebar.
  return createPortal(
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Create campaign"
      className="fixed inset-0 z-50 flex flex-col bg-surface animate-fade-in"
    >
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
    </div>,
    document.body,
  )
}

// Public helper — converts a wizard submission to the shape
// `createCampaign` already accepts. Lives here so the Home page
// doesn't need to know the audience-field mapping.
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

// Re-export so the spec can target the storage key without importing
// internals.
export { STORAGE_KEY as WIZARD_STORAGE_KEY }
