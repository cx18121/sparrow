import { useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import { PREVIEW_FALLBACK, PREVIEW_SAMPLE } from '../../../lib/previewSample'
import { stripHtml } from '../_helpers'
import StepHeader, { TOTAL_STEPS } from '../StepHeader'

interface PreviewData {
  first_name: string
  last_name: string
  company: string
  role: string
  sender_name: string
  feature_line: string | null
  fit_angle: string | null
  trigger_line: string | null
  proof_of_motion: string | null
  inflection_line: string | null
  system_built: string | null
}

// Mirrors server-side dropEmptyTagParagraphs: when any personalization
// tag is missing, drop the entire paragraph anchored on that tag so the
// preview shows what production would actually ship — no orphaned
// "For context, feels like a stepping stone…" sentences.
export function fillVariables(content: string, data: PreviewData): string {
  if (!content) return ''
  const featureEmpty = !data.feature_line
  const fitEmpty = !data.fit_angle
  const triggerEmpty = !data.trigger_line
  const proofEmpty = !data.proof_of_motion
  const inflectionEmpty = !data.inflection_line
  const systemEmpty = !data.system_built
  const anyEmpty = featureEmpty || fitEmpty || triggerEmpty || proofEmpty || inflectionEmpty || systemEmpty
  const trimmed = anyEmpty
    ? content.split(/\n\s*\n/).filter(para => {
        if (featureEmpty && /\{\{(feature_line|featureLine)\}\}/.test(para)) return false
        if (fitEmpty && /\{\{(fit_angle|fitAngle)\}\}/.test(para)) return false
        if (triggerEmpty && /\{\{(trigger_line|triggerLine)\}\}/.test(para)) return false
        if (proofEmpty && /\{\{(proof_of_motion|proofOfMotion)\}\}/.test(para)) return false
        if (inflectionEmpty && /\{\{(inflection_line|inflectionLine)\}\}/.test(para)) return false
        if (systemEmpty && /\{\{(system_built|systemBuilt)\}\}/.test(para)) return false
        return true
      }).join('\n\n')
    : content
  return trimmed
    .replace(/\{\{first_name\}\}/g, data.first_name)
    .replace(/\{\{last_name\}\}/g, data.last_name)
    .replace(/\{\{company\}\}/g, data.company)
    .replace(/\{\{role\}\}/g, data.role)
    .replace(/\{\{sender_name\}\}/g, data.sender_name)
    .replace(/\{\{feature_line\}\}/g, data.feature_line ?? '')
    .replace(/\{\{fit_angle\}\}/g, data.fit_angle ?? '')
    .replace(/\{\{trigger_line\}\}/g, data.trigger_line ?? '')
    .replace(/\{\{proof_of_motion\}\}/g, data.proof_of_motion ?? '')
    .replace(/\{\{inflection_line\}\}/g, data.inflection_line ?? '')
    .replace(/\{\{system_built\}\}/g, data.system_built ?? '')
}

const MERGE_TAGS: ReadonlyArray<{ tag: string; label: string }> = [
  { tag: '{{first_name}}',     label: 'first name' },
  { tag: '{{last_name}}',      label: 'last name' },
  { tag: '{{company}}',        label: 'company' },
  { tag: '{{role}}',           label: 'role' },
  { tag: '{{sender_name}}',    label: 'your name' },
  // Eng / product personalization tags.
  { tag: '{{feature_line}}',   label: 'feature line' },
  { tag: '{{fit_angle}}',      label: 'fit angle' },
  // GTM personalization tags.
  { tag: '{{trigger_line}}',   label: 'trigger line' },
  { tag: '{{proof_of_motion}}', label: 'proof of motion' },
  // Ops personalization tags.
  { tag: '{{inflection_line}}', label: 'inflection line' },
  { tag: '{{system_built}}',   label: 'system built' },
]

export default function TemplateStep({
  form, templates, selectedTemplate, updateField, updateCustomTemplate, setTemplateMode, aiPreview, isLoadingPreview, showBodyError,
}: {
  form: {
    senderName: string
    templateId: string
    templateMode: string
    customTemplate: { name: string; subject: string; body: string }
  }
  templates: Array<{ id: string; name: string; subject: string; body: string; userId?: string }>
  selectedTemplate: { subject: string; body: string } | null
  updateField: (key: string, value: unknown) => void
  updateCustomTemplate: (key: 'name' | 'subject' | 'body', value: string) => void
  setTemplateMode: (mode: 'existing' | 'custom') => void
  aiPreview: { featureLine: string | null; fitAngle: string | null }
  isLoadingPreview: boolean
  showBodyError: boolean
}) {
  // Library templates are preview-only — picking one here would set the
  // workspace's default templateId to a row the draft-generation endpoint
  // refuses to load. Onboarding only offers the user's own templates;
  // library templates are reached via the Templates tab clone flow.
  const personalTemplates = templates.filter(t => t?.userId !== '__library__')
  const hasTemplates = personalTemplates.length > 0
  const writingMode = !hasTemplates || form.templateMode !== 'existing'
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [activeField, setActiveField] = useState<'subject' | 'body'>('body')

  const previewData: PreviewData = {
    first_name: PREVIEW_SAMPLE.first_name,
    last_name: PREVIEW_SAMPLE.last_name,
    company: PREVIEW_SAMPLE.company,
    role: PREVIEW_SAMPLE.role,
    sender_name: form.senderName || PREVIEW_SAMPLE.sender_name,
    feature_line: aiPreview.featureLine ?? (isLoadingPreview ? '…' : PREVIEW_FALLBACK.feature_line),
    fit_angle: aiPreview.fitAngle ?? (isLoadingPreview ? '…' : PREVIEW_FALLBACK.fit_angle),
    // GTM and ops merge tags don't have a live preview pipeline today
    // (preview-fit-angle.ts is eng-only). Fall back to the sample values
    // so ops/gtm default templates render a readable preview here.
    trigger_line: PREVIEW_FALLBACK.trigger_line,
    proof_of_motion: PREVIEW_FALLBACK.proof_of_motion,
    inflection_line: PREVIEW_FALLBACK.inflection_line,
    system_built: PREVIEW_FALLBACK.system_built,
  }

  // Insert a merge tag at the caret of whichever field was last focused.
  // Falls back to appending if nothing has been focused yet.
  const insertTag = (tag: string) => {
    const el = activeField === 'subject' ? subjectRef.current : bodyRef.current
    const current = activeField === 'subject' ? form.customTemplate.subject : form.customTemplate.body
    const setter = (next: string) => updateCustomTemplate(activeField, next)
    if (!el) {
      setter((current || '') + tag)
      return
    }
    const start = el.selectionStart ?? current.length
    const end = el.selectionEnd ?? current.length
    const next = current.slice(0, start) + tag + current.slice(end)
    setter(next)
    requestAnimationFrame(() => {
      const pos = start + tag.length
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <StepHeader
        step={2}
        total={TOTAL_STEPS}
        title="Your template"
        description="Set the starting point for each draft."
      />

      {writingMode ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="onboarding-template-name" className="label">Template name</label>
            <input
              id="onboarding-template-name"
              value={form.customTemplate.name}
              onChange={e => updateCustomTemplate('name', e.target.value)}
              placeholder="Founder intro"
              className="input"
            />
          </div>
          <div>
            <label htmlFor="onboarding-template-subject" className="label">Subject</label>
            <input
              id="onboarding-template-subject"
              ref={subjectRef}
              value={form.customTemplate.subject}
              onChange={e => updateCustomTemplate('subject', e.target.value)}
              onFocus={() => setActiveField('subject')}
              placeholder="Quick thought about {{company}}"
              className="input"
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label htmlFor="onboarding-template-body" className="label mb-0">Body</label>
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/60">
                  Insert
                </span>
                {MERGE_TAGS.map(({ tag, label }) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => insertTag(tag)}
                    title={`Inserts ${tag}`}
                    className="inline-flex items-center rounded-full border border-warm-300 bg-warm-50 px-2 py-0.5 text-[10px] font-medium text-muted transition-colors hover:border-primary/40 hover:text-dark"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              id="onboarding-template-body"
              ref={bodyRef}
              value={form.customTemplate.body}
              onChange={e => updateCustomTemplate('body', e.target.value)}
              onFocus={() => setActiveField('body')}
              placeholder={"Hi {{first_name}},\n\nI noticed {{company}} and wanted to reach out because...\n\nBest,\n{{sender_name}}"}
              className={`input min-h-[220px] resize-y font-mono text-[13px] leading-relaxed ${showBodyError ? 'input-error' : ''}`}
              aria-invalid={showBodyError}
            />
            {showBodyError && (
              <p className="mt-1.5 form-error-text">Please add an email body before continuing.</p>
            )}
          </div>

          {(form.customTemplate.subject || form.customTemplate.body) && (
            <div className="rounded-xl border border-warm-200 bg-warm-50/60">
              <p className="px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/70">
                Preview <span className="normal-case tracking-normal font-normal">— filled with sample lead</span>
              </p>
              <div className="border-t border-warm-200 px-4 py-3">
                {form.customTemplate.subject && (
                  <p className="text-sm font-medium text-dark">
                    {fillVariables(form.customTemplate.subject, previewData)}
                  </p>
                )}
                {form.customTemplate.body && (
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-dark/85">
                    {fillVariables(form.customTemplate.body, previewData)}
                  </p>
                )}
              </div>
            </div>
          )}

          {hasTemplates && (
            <button
              type="button"
              onClick={() => setTemplateMode('existing')}
              className="text-xs font-medium text-primary hover:underline"
            >
              Use a saved template instead →
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <label htmlFor="onboarding-existing-template" className="label">Template</label>
              <div className="relative">
                <FileText size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <select
                  id="onboarding-existing-template"
                  value={form.templateId}
                  onChange={e => updateField('templateId', e.target.value)}
                  className="select pl-8"
                >
                  {personalTemplates.map(template => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setTemplateMode('custom')}
              className="self-end pb-1 text-xs font-medium text-primary hover:underline"
            >
              Write a new one →
            </button>
          </div>

          {selectedTemplate && (
            <div className="rounded-xl border border-warm-200 bg-warm-50/60">
              <div className="border-b border-warm-200 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Preview</p>
                <p className="mt-1 text-sm font-medium text-dark">
                  {fillVariables(selectedTemplate.subject, previewData)}
                </p>
              </div>
              <div className="px-4 py-4 text-sm leading-7 text-dark">
                {stripHtml(fillVariables(selectedTemplate.body, previewData))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
