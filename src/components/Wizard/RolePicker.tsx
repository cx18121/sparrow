import { useState } from 'react'
import { Users } from 'lucide-react'
import {
  DEFAULT_ROLE_FAMILY, labelForRoleFamily, type RoleFamily,
} from '../../types/roleFamilies'
import { RoleTiles } from '../ui/RoleTiles'

// Per-campaign role selector. Renders as a compact summary line until
// the user clicks "Change" — then expands to four tile-cards (one per
// family). `value` is the explicit per-campaign override (null =
// inherit). The summary line always shows what's currently in effect
// (override > default > engineering at apollo time), so users can see
// the live state without expanding the picker.
//
// Single-select by design: each campaign targets one role family. The
// email-generation strategy forks on this value, and reasoning about
// "what kind of pitch is this campaign" gets harder with multiple
// roles in play.

export default function RolePicker({
  value, defaultValue, onChange,
}: {
  value: RoleFamily | null
  defaultValue: RoleFamily | null
  onChange: (next: RoleFamily | null) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // The role rendered in the summary line — the explicit override if
  // set, otherwise the user's workspace default, otherwise the
  // registry default. Mirrors the resolution order in
  // apollo.ts:resolveTargetTitles so the UI never lies about what
  // Apollo will actually query.
  const effective: RoleFamily = value ?? defaultValue ?? DEFAULT_ROLE_FAMILY
  const overrideActive = value !== null && value !== defaultValue
  // Picking the role that matches the inherited default clears the
  // override instead of pinning it explicitly — keeps the campaign
  // in "inherit" mode so a later Settings change still propagates here.
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
