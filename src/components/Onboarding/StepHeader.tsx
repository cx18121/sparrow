// Shared step-header strip for the onboarding flow. Three steps: About,
// Template, Gmail.

export const TOTAL_STEPS = 3
const STEP_LABELS = ['About', 'Template', 'Gmail']

export default function StepHeader({
  step, total, title, description,
}: {
  step: number
  total: number
  title: string
  description?: string
}) {
  return (
    <div className="mb-6 text-center sm:mb-7">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
        {STEP_LABELS[step - 1]} · Step {step} of {total}
      </p>
      <h1 className="mt-3 text-2xl font-display font-semibold text-dark sm:text-3xl">{title}</h1>
      {description && (
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">{description}</p>
      )}
    </div>
  )
}
