import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { StepHeader } from '../_shared'

const NAME_SUGGESTIONS = [
  'Spring 2026 outreach',
  'YC W26 hiring',
  'Series A AI infra',
  'Climate-tech founders',
]

export default function StepName({
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
