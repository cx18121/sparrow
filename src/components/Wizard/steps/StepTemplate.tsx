import { FileText } from 'lucide-react'
import type { Template } from '../../../types/api'
import { fillTemplateTags, stripPreviewHtml } from '../../../lib/templatePreview'
import { StepHeader } from '../_shared'

export default function StepTemplate({
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
