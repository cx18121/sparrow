import React from 'react'

// Tiny layout primitives shared across all four wizard steps.
// StepHeader is the title-plus-icon used at the top of each step;
// FilterRow + FilterChip are the row label + pill styling for the
// Filters step (kept here because the Review step's display pills
// would otherwise reach into StepFilters' internals).

export function StepHeader({
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

export function FilterRow({
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

export function FilterChip({
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
