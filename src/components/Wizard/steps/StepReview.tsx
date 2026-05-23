import React from 'react'
import { Users } from 'lucide-react'
import { audienceToDisplayPills, type Audience } from '../../../types/audience'
import type { Template } from '../../../types/api'
import { StepHeader } from '../_shared'

// Subset of ScratchState that StepReview actually reads. Decoupled
// from the full ScratchState so the wizard's localStorage shape can
// evolve without touching this file.
export interface StepReviewState {
  name: string
  audience: Audience
  templateId: string | null
  includePreviouslySaved: boolean
}

export default function StepReview({
  state, templates, onJumpTo,
}: {
  state: StepReviewState
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
