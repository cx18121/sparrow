import React from 'react'
import { ROLE_FAMILIES, type RoleFamily } from '../../types/roleFamilies'

// Single-select tile grid for picking a RoleFamily. Shared between the wizard
// (per-campaign override) and onboarding/Settings (workspace default).
//
// Intentionally minimal: no header, no help text, no "Done" button — the
// caller owns the surrounding chrome. Allows the same tiles to render
// inline in onboarding's stacked layout, in the wizard's expandable
// drawer, and in a Settings tab cell without per-callsite hacks.
//
// `value === null` is valid (campaign with no override). Selecting any
// tile commits a non-null choice via onChange; callers that want
// "selecting the inherited default re-clears the override" implement
// that policy on top — RoleTiles is dumb on purpose.
export function RoleTiles({
  value,
  onChange,
}: {
  value: RoleFamily | null
  onChange: (next: RoleFamily) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {ROLE_FAMILIES.map(family => {
        const active = family.id === value
        return (
          <button
            type="button"
            key={family.id}
            onClick={() => onChange(family.id)}
            aria-pressed={active}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-all ${
              active
                ? 'border-primary bg-primary/5'
                : 'border-warm-200 bg-warm-50 hover:border-primary/40'
            }`}
          >
            <span
              className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                active ? 'border-primary bg-primary' : 'border-warm-400 bg-transparent'
              }`}
            />
            <span className="text-[12px] font-medium text-dark">{family.label}</span>
          </button>
        )
      })}
    </div>
  )
}
