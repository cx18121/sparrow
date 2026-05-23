import React, { useEffect, useState } from 'react'
import { AlertCircle, Check, Loader2 } from 'lucide-react'
import type { WorkspaceConfig } from '../../lib/workspaceConfig'

// Shared form primitives used by all three Settings tabs. Lives next
// to the tab files (not in src/components/ui/) because nothing else in
// the app uses these — they're settings-form-specific shapes that
// would just add API surface to /ui/ without a reuser.

// onSave on a tab forwards through App.tsx's updateWorkspaceConfig,
// which accepts either a full config to persist or a functional
// updater that receives the current config. The union mirrors React's
// setState signature so tabs can do partial updates without re-reading
// workspaceConfig.
export type WorkspaceConfigUpdater = WorkspaceConfig | ((current: WorkspaceConfig) => WorkspaceConfig)
export type SaveWorkspaceConfig = (updater: WorkspaceConfigUpdater) => Promise<boolean>

export function SaveBar({ dirty, saving, onSave, onDiscard, label = 'Save changes' }: {
  dirty: boolean; saving: boolean; onSave: () => void; onDiscard?: () => void; label?: string
}) {
  if (!dirty && !saving) return null
  return (
    <div className="sticky bottom-0 z-10 -mx-1 mt-2 flex items-center justify-end gap-2 rounded-2xl border border-warm-200 bg-warm-50/95 px-3 py-2 backdrop-blur">
      {onDiscard && (
        <button type="button" onClick={onDiscard} disabled={saving} className="btn-ghost text-xs">
          Discard
        </button>
      )}
      <button type="button" onClick={onSave} disabled={saving} className="btn-primary text-xs">
        {saving ? <><Loader2 size={13} className="animate-spin" /> Saving</> : <><Check size={13} /> {label}</>}
      </button>
    </div>
  )
}

export function CapabilityRow({ icon: Icon, label, enabled, disabledHint }: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  enabled: boolean
  disabledHint?: string
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon size={12} className={enabled ? 'text-emerald-600' : 'text-amber-600'} />
      <span className="font-medium text-dark">{label}</span>
      <span className={`ml-auto inline-flex items-center gap-1 ${enabled ? 'text-emerald-700' : 'text-amber-700'}`}>
        {enabled ? <Check size={11} /> : <AlertCircle size={11} />}
        {enabled ? 'Active' : (disabledHint ?? 'Off')}
      </span>
    </div>
  )
}

export function FieldGroup({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="surface-panel py-2">
      <header className="mb-4">
        <h3 className="font-display text-base font-semibold text-dark">{title}</h3>
        {hint && <p className="mt-1 text-xs leading-5 text-muted">{hint}</p>}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

// Number input that clamps on blur, not on every keystroke — so users
// can clear and retype without the value snapping back to min mid-edit.
// When the typed value lands outside [min, max] on blur, `onClamp`
// fires with the raw typed value and the clamped result so the parent
// can surface a toast or inline message (otherwise the silent clamp
// confuses users who think their number was accepted).
type ClampedNumberInputProps = {
  value: number
  onChange: (next: number) => void
  min: number
  max: number
  onClamp?: (info: { raw: number; clamped: number }) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'type'>

export function ClampedNumberInput({ value, onChange, min, max, onClamp, ...rest }: ClampedNumberInputProps) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={text}
      onChange={e => {
        const raw = e.target.value
        setText(raw)
        const n = parseInt(raw, 10)
        if (!Number.isNaN(n)) onChange(n)
      }}
      onBlur={() => {
        const n = parseInt(text, 10)
        // Empty / non-numeric on blur: revert to the last good value
        // instead of silently snapping to min. An accidental clear
        // used to wipe the user's setting to `min` with no feedback —
        // preserving the prior value matches what most form libraries
        // do.
        if (Number.isNaN(n)) {
          setText(String(value))
          return
        }
        const clamped = Math.min(max, Math.max(min, n))
        setText(String(clamped))
        if (clamped !== value) onChange(clamped)
        if (n !== clamped) onClamp?.({ raw: n, clamped })
      }}
    />
  )
}
