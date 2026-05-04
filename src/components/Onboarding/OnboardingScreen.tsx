import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Building2, FileText, Upload, User } from 'lucide-react'
import Banner from '../ui/Banner'
import { createWorkspaceConfig } from '../../lib/workspaceConfig'
import { supabase, isDemo } from '../../lib/supabase'
import {
  STYLE_TESTS, STYLE_LABELS, STYLE_PROMPTS, DEFAULT_STYLE_PROFILE,
  scoreStyleChoices,
} from '../../lib/styleProfile'

const TOTAL_STEPS = 3
const STEP_LABELS = ['About', 'Style', 'Template']

function fillVariables(content, data) {
  if (!content) return ''
  return content
    .replace(/\{\{first_name\}\}/g, data.first_name)
    .replace(/\{\{last_name\}\}/g, data.last_name)
    .replace(/\{\{company\}\}/g, data.company)
    .replace(/\{\{role\}\}/g, data.role)
    .replace(/\{\{sender_name\}\}/g, data.sender_name)
}

function stripHtml(content) {
  if (!content) return ''
  if (!content.includes('<')) return content

  if (typeof window !== 'undefined' && window.DOMParser) {
    const doc = new DOMParser().parseFromString(content, 'text/html')
    doc.body.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
    doc.body.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li').forEach(node => {
      node.appendChild(doc.createTextNode('\n\n'))
    })
    return (doc.body.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  return content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function buildStyleTemplate(profile) {
  const traits = profile?.traits || DEFAULT_STYLE_PROFILE.traits
  const isDirect = traits.includes('direct')
  const isWarm = traits.includes('warm')
  const isSpecific = traits.includes('specific')
  const isConcise = traits.includes('concise')
  const sender = '{{sender_name}}'

  const opening = isWarm
    ? 'I came across {{company}} and your team stood out.'
    : 'I noticed {{company}} and wanted to reach out.'
  const context = isSpecific
    ? 'My recent work has focused on turning research and outreach into clear, targeted first drafts.'
    : 'I am working on practical outreach systems and thought there may be a useful fit.'
  const ask = isDirect
    ? 'Would you be open to a 15-minute conversation next week?'
    : 'If useful, I would be glad to connect when timing is easy.'
  const body = isConcise
    ? `Hi {{first_name}},\n\n${opening} ${context}\n\n${ask}\n\nBest,\n${sender}`
    : `Hi {{first_name}},\n\n${opening}\n\n${context}\n\n${ask}\n\nBest,\n${sender}`

  return {
    id: '',
    name: 'Personal style template',
    subject: isDirect ? 'Quick question about {{company}}' : 'Thought on {{company}}',
    body,
    isShared: false,
  }
}

function withGeneratedStyleTemplate(data, { force = false } = {}) {
  const styleProfile = data.styleProfile || scoreStyleChoices(data.styleChoices)
  const shouldGenerate = force
    || data.templateMode !== 'custom'
    || !data.customTemplate?.subject
    || !data.customTemplate?.body
    || data.customTemplate?.name === 'Personal style template'

  if (!shouldGenerate) {
    return { ...data, styleProfile }
  }

  return {
    ...data,
    styleProfile,
    templateMode: 'custom',
    customTemplate: buildStyleTemplate(styleProfile),
  }
}

function StepHeader({ step, total, title, description = undefined }) {
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

function AboutStep({ form, updateField, onUploadResume, uploadState, showNameError }) {
  const statusLabel = uploadState.uploading
    ? 'Uploading…'
    : uploadState.error
      ? `Could not upload: ${uploadState.error}`
      : form.resumeFileName || 'Upload resume or bio'

  return (
    <div className="mx-auto w-full max-w-2xl">
      <StepHeader
        step={1}
        total={TOTAL_STEPS}
        title="About you"
      />

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Name <span className="text-red-500">*</span></label>
            <div className="relative">
              <User size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={form.senderName}
                onChange={e => updateField('senderName', e.target.value)}
                placeholder="Maya Chen"
                className={`input pl-8 ${showNameError ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''}`}
                aria-invalid={showNameError}
              />
            </div>
            {showNameError && (
              <p className="mt-2 text-xs text-red-500">Name is required.</p>
            )}
          </div>
          <div>
            <label className="label">Role</label>
            <input
              value={form.senderRole}
              onChange={e => updateField('senderRole', e.target.value)}
              placeholder="Founder, GTM Lead, SDR"
              className="input"
            />
          </div>
        </div>

        <div>
          <label className="label">Company</label>
          <div className="relative">
            <Building2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={form.senderCompany}
              onChange={e => updateField('senderCompany', e.target.value)}
              placeholder="Cornell Generative AI"
              className="input pl-8"
            />
          </div>
        </div>

        <div>
          <textarea
            value={form.resumeText}
            onChange={e => updateField('resumeText', e.target.value)}
            placeholder="Relevant experience, club role, recent work..."
            className="input min-h-[140px] resize-none bg-warm-50"
          />
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-warm-300 bg-warm-50/70 px-4 py-3 transition-colors hover:border-primary/40 hover:bg-primary/5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-dark">{statusLabel}</p>
            <p className="mt-1 text-xs text-muted">Optional: PDF, DOCX, or TXT.</p>
          </div>
          <Upload size={18} className="shrink-0 text-primary" />
          <input
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            className="hidden"
            disabled={uploadState.uploading}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) onUploadResume(file)
            }}
          />
        </label>
      </div>
    </div>
  )
}

function StyleStep({ form, updateStyleChoice, showMissing }) {
  const [activeIndex, setActiveIndex] = useState(() => {
    const firstIncomplete = STYLE_TESTS.findIndex(test => !form.styleChoices?.[test.id])
    return firstIncomplete >= 0 ? firstIncomplete : 0
  })
  const profile = form.styleProfile || DEFAULT_STYLE_PROFILE
  const completed = STYLE_TESTS.filter(test => form.styleChoices?.[test.id]).length
  const activeTest = STYLE_TESTS[activeIndex]
  const selected = form.styleChoices?.[activeTest.id]
  const sampleData = { first_name: 'Alex', last_name: 'Chen', company: 'Momentum AI', role: 'CEO', sender_name: form.senderName || 'Your Name' }
  const nextIncompleteIndex = STYLE_TESTS.findIndex(test => !form.styleChoices?.[test.id])

  const choose = (choice) => {
    updateStyleChoice(activeTest.id, choice)
    const followingIncomplete = STYLE_TESTS.findIndex((test, index) => index > activeIndex && !form.styleChoices?.[test.id])
    if (followingIncomplete >= 0) {
      setActiveIndex(followingIncomplete)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <StepHeader
        step={2}
        total={TOTAL_STEPS}
        title="Your email style"
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_200px]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warm-200 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                {activeIndex + 1} of {STYLE_TESTS.length}
              </p>
              <h2 className="mt-1 text-xl font-semibold text-dark">{activeTest.label}</h2>
              <p className="mt-1 text-sm text-muted">{activeTest.dimension}</p>
            </div>
            <div className="flex gap-1.5">
              {STYLE_TESTS.map((test, index) => (
                <button
                  key={test.id}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  aria-label={`Show comparison ${index + 1}`}
                  className={`h-2.5 rounded-full transition-all ${
                    index === activeIndex
                      ? 'w-8 bg-primary'
                      : form.styleChoices?.[test.id]
                        ? 'w-2.5 bg-primary/45'
                        : 'w-2.5 bg-stone-300'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {['a', 'b'].map(key => {
              const option = activeTest[key]
              const isSelected = selected === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => choose(key)}
                  aria-pressed={isSelected}
                  className={`flex min-h-[260px] flex-col rounded-2xl border px-5 py-4 text-left transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-[0_14px_32px_rgba(85,122,87,0.12)]'
                      : 'border-accent/20 bg-surface hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card'
                  }`}
                >
                  <p className="mb-3 text-base font-semibold text-dark">{option.label}</p>
                  <p className="whitespace-pre-line text-sm leading-6 text-dark">
                    {fillVariables(option.body, sampleData)}
                  </p>
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {showMissing && completed < STYLE_TESTS.length ? (
              <p className="text-xs font-medium text-red-500">Pick one option for each comparison to continue.</p>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => setActiveIndex(nextIncompleteIndex >= 0 ? nextIncompleteIndex : Math.min(activeIndex + 1, STYLE_TESTS.length - 1))}
              className="btn-ghost px-3 py-2 text-xs"
            >
              {nextIncompleteIndex >= 0 ? 'Next unanswered' : 'Review picks'}
            </button>
          </div>
        </div>

        <aside className="rounded-2xl border border-warm-300 bg-warm-50 px-4 py-4">
          {profile.traits.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {profile.traits.map(trait => (
                <span key={trait} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  {trait}
                </span>
              ))}
            </div>
          )}

          <div className="space-y-1">
            {STYLE_TESTS.map((test, index) => {
              const pick = form.styleChoices?.[test.id]
              return (
                <button
                  key={test.id}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-warm-50"
                >
                  <span className="text-xs font-medium text-dark">{test.label}</span>
                  <span className={`text-xs font-semibold ${pick ? 'text-primary' : 'text-muted'}`}>
                    {pick ? test[pick].label : 'Choose'}
                  </span>
                </button>
              )
            })}
          </div>
        </aside>
      </div>
    </div>
  )
}

const MERGE_TAGS: ReadonlyArray<{ tag: string; label: string }> = [
  { tag: '{{first_name}}', label: 'first name' },
  { tag: '{{last_name}}',  label: 'last name' },
  { tag: '{{company}}',    label: 'company' },
  { tag: '{{role}}',       label: 'role' },
  { tag: '{{sender_name}}', label: 'your name' },
]

function TemplateStep({ form, templates, selectedTemplate, updateField, updateCustomTemplate, setTemplateMode }) {
  const hasTemplates = templates.length > 0
  const writingMode = !hasTemplates || form.templateMode !== 'existing'
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [activeField, setActiveField] = useState<'subject' | 'body'>('body')

  const previewData = {
    first_name: 'Alex',
    last_name: 'Chen',
    company: 'Momentum AI',
    role: 'Co-founder & CEO',
    sender_name: form.senderName || 'Your Name',
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
        step={3}
        total={TOTAL_STEPS}
        title="Your template"
        description="Set the starting point for each draft."
      />

      {writingMode ? (
        <div className="space-y-4">
          <div>
            <label className="label">Template name</label>
            <input
              value={form.customTemplate.name}
              onChange={e => updateCustomTemplate('name', e.target.value)}
              placeholder="Founder intro"
              className="input"
            />
          </div>
          <div>
            <label className="label">Subject</label>
            <input
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
              <span className="label mb-0">Body</span>
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
              ref={bodyRef}
              value={form.customTemplate.body}
              onChange={e => updateCustomTemplate('body', e.target.value)}
              onFocus={() => setActiveField('body')}
              placeholder={"Hi {{first_name}},\n\nI noticed {{company}} and wanted to reach out because...\n\nBest,\n{{sender_name}}"}
              className="input min-h-[220px] resize-y font-mono text-[13px] leading-relaxed"
            />
          </div>

          {(form.customTemplate.subject || form.customTemplate.body) && (
            <details className="group rounded-xl border border-warm-200 bg-warm-50/60 open:bg-warm-50">
              <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-xs font-medium text-muted hover:text-dark">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">Preview</span>
                <span className="text-muted/70">filled with sample lead</span>
              </summary>
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
            </details>
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
              <label className="label">Template</label>
              <div className="relative">
                <FileText size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <select
                  value={form.templateId}
                  onChange={e => updateField('templateId', e.target.value)}
                  className="select pl-8"
                >
                  {templates.map(template => (
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

export default function OnboardingScreen({
  user,
  templates,
  initialData,
  onSaveDraft,
  onFinishLater,
  onComplete,
  onLogout,
}) {
  const [stepIndex, setStepIndex] = useState(0)
  const [senderNameAttempted, setSenderNameAttempted] = useState(false)
  const [styleAttempted, setStyleAttempted] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [resumeUpload, setResumeUpload] = useState({ uploading: false, error: null })

  const buildInitialForm = (data) => {
    const config = createWorkspaceConfig({ user, templates, data })
    return {
      ...config,
      customTemplate: {
        ...config.customTemplate,
        body: stripHtml(config.customTemplate.body || ''),
      },
    }
  }
  const [form, setForm] = useState(() => buildInitialForm(initialData))
  const userEditedRef = useRef(false)
  const syncMountedRef = useRef(false)

  const saveDraftMounted = useRef(false)
  useEffect(() => {
    if (!saveDraftMounted.current) { saveDraftMounted.current = true; return }
    onSaveDraft?.(form)
  }, [form, onSaveDraft])

  useEffect(() => {
    if (!syncMountedRef.current) {
      syncMountedRef.current = true
      return
    }
    if (userEditedRef.current) return
    setForm(buildInitialForm(initialData))
  }, [initialData, templates, user])

  useEffect(() => {
    if (form.senderName.trim()) {
      setSenderNameAttempted(false)
    }
  }, [form.senderName])

  useEffect(() => {
    if (STYLE_TESTS.every(test => form.styleChoices?.[test.id])) {
      setStyleAttempted(false)
    }
  }, [form.styleChoices])

  const selectedTemplate = useMemo(
    () => templates.find(template => template.id === form.templateId) || templates[0] || null,
    [form.templateId, templates]
  )

  const markUserEdited = () => { userEditedRef.current = true }
  const updateField = (key, value) => {
    markUserEdited()
    setSaveError('')
    setForm(current => ({ ...current, [key]: value }))
  }
  const updateCustomTemplate = (key, value) => {
    markUserEdited()
    setSaveError('')
    setForm(current => ({
      ...current,
      customTemplate: { ...current.customTemplate, [key]: value },
    }))
  }
  const updateStyleChoice = (testId, choice) => {
    markUserEdited()
    setSaveError('')
    setForm(current => {
      const styleChoices = { ...(current.styleChoices || {}), [testId]: choice }
      const styleProfile = scoreStyleChoices(styleChoices)
      return withGeneratedStyleTemplate({ ...current, styleChoices, styleProfile })
    })
  }
  const handleUploadResume = async (file) => {
    if (!file) return
    setResumeUpload({ uploading: true, error: null })
    if (file.size > 10 * 1024 * 1024) {
      setResumeUpload({ uploading: false, error: 'File must be under 10 MB.' })
      return
    }

    if (isDemo || !user?.id) {
      markUserEdited()
      setForm(current => ({ ...current, resumeFileName: file.name, resumePath: '' }))
      setResumeUpload({ uploading: false, error: null })
      return
    }

    const path = `${user.id}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage
      .from('resumes')
      .upload(path, file, { upsert: true, contentType: file.type || undefined })

    if (error) {
      setResumeUpload({ uploading: false, error: error.message })
      return
    }

    markUserEdited()
    setForm(current => ({ ...current, resumeFileName: file.name, resumePath: path }))
    setResumeUpload({ uploading: false, error: null })
  }

  const setTemplateMode = (mode) => {
    markUserEdited()
    setForm(current => {
      if (mode === 'custom' && !current.customTemplate.subject && selectedTemplate) {
        return {
          ...current,
          templateMode: mode,
          customTemplate: {
            ...current.customTemplate,
            name: current.customTemplate.name || `${selectedTemplate.name} (Custom)`,
            subject: selectedTemplate.subject,
            body: stripHtml(selectedTemplate.body),
          },
        }
      }
      return { ...current, templateMode: mode }
    })
  }

  const steps = [
    <AboutStep
      key="about"
      form={form}
      updateField={updateField}
      onUploadResume={handleUploadResume}
      uploadState={resumeUpload}
      showNameError={stepIndex === 0 && senderNameAttempted && !form.senderName.trim()}
    />,
    <StyleStep
      key="style"
      form={form}
      updateStyleChoice={updateStyleChoice}
      showMissing={styleAttempted}
    />,
    <TemplateStep
      key="template"
      form={form}
      templates={templates}
      selectedTemplate={selectedTemplate}
      updateField={updateField}
      updateCustomTemplate={updateCustomTemplate}
      setTemplateMode={setTemplateMode}
    />,
  ]

  const isFirstStep = stepIndex === 0
  const isLastStep = stepIndex === steps.length - 1
  const contentWidthClass = stepIndex === 1 ? 'max-w-5xl' : 'max-w-2xl'
  const isSenderNameValid = Boolean(form.senderName.trim())
  const isStyleComplete = STYLE_TESTS.every(test => form.styleChoices?.[test.id])

  const nextStep = () => {
    if (stepIndex === 0 && !isSenderNameValid) {
      setSenderNameAttempted(true)
      return
    }
    if (stepIndex === 1) {
      if (!isStyleComplete) {
        setStyleAttempted(true)
        return
      }
      const nextForm = withGeneratedStyleTemplate(form, { force: true })
      setForm(nextForm)
    }
    setStepIndex(index => Math.min(index + 1, steps.length - 1))
  }
  const prevStep = () => setStepIndex(index => Math.max(index - 1, 0))
  const goToStep = (index) => {
    if (index > 0 && !isSenderNameValid) {
      setSenderNameAttempted(true)
      setStepIndex(0)
      return
    }
    if (index > 1 && !isStyleComplete) {
      setStyleAttempted(true)
      setStepIndex(1)
      return
    }
    if (index === 2) {
      setForm(current => withGeneratedStyleTemplate(current, { force: true }))
    }
    setStepIndex(index)
  }

  const finish = async (skipped = false) => {
    if (isSaving || resumeUpload.uploading) return
    const needsGeneratedTemplate = !skipped && (
      (form.templateMode === 'custom' && (!form.customTemplate?.subject || !form.customTemplate?.body))
      || (form.templateMode !== 'custom' && !selectedTemplate)
    )
    const finalForm = needsGeneratedTemplate ? withGeneratedStyleTemplate(form, { force: true }) : form

    setSaveError('')
    setIsSaving(true)
    try {
      const payload = {
        ...finalForm,
        templateId: finalForm.templateMode === 'custom' ? '' : selectedTemplate?.id || '',
        skipped,
      }
      if (skipped) {
        await onFinishLater?.(payload)
      } else {
        await onComplete?.(payload)
      }
    } catch (err) {
      setSaveError(err.message || 'Setup could not be saved. Try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleLogout = async () => {
    if (!onLogout || isSigningOut) return
    setIsSigningOut(true)
    try {
      await onLogout()
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface">
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 pt-8 pb-12 sm:px-10 sm:pb-14 lg:px-14">
        <div className="flex items-start justify-between gap-4">
          <button
            type="button"
            onClick={handleLogout}
            disabled={isSigningOut}
            className="-ml-2 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-muted transition-all duration-150 hover:-translate-y-0.5 hover:text-dark disabled:cursor-not-allowed disabled:opacity-50 sm:-ml-5 lg:-ml-8"
          >
            {isSigningOut ? 'Signing out...' : 'Sign out'}
          </button>
          <button
            type="button"
            onClick={() => finish(true)}
            disabled={isSaving || resumeUpload.uploading}
            className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-muted transition-all duration-150 hover:-translate-y-0.5 hover:text-dark"
          >
            {isSaving ? 'Saving...' : 'Finish later'}
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center py-8">
          <div className={`w-full ${contentWidthClass}`}>
            {steps[stepIndex]}
          </div>
        </div>

        <div className="pt-2">
          <div className="mb-5 flex items-center justify-center gap-2">
            {steps.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => goToStep(index)}
                aria-label={`Go to ${STEP_LABELS[index]}`}
                className={`group flex h-8 items-center rounded-full px-1 transition-all ${
                  index === stepIndex ? 'bg-primary/10' : 'hover:bg-warm-50/76'
                }`}
              >
                <span className={`h-2.5 rounded-full transition-all ${
                  index === stepIndex ? 'w-8 bg-primary' : 'w-2.5 bg-stone-300 group-hover:bg-stone-400'
                }`} />
                <span className={`hidden pl-2 pr-2 text-xs font-medium sm:inline ${
                  index === stepIndex ? 'text-primary' : 'text-muted'
                }`}>
                  {STEP_LABELS[index]}
                </span>
              </button>
            ))}
          </div>

          {saveError && (
            <Banner variant="danger" className="mx-auto mb-3 max-w-xl">{saveError}</Banner>
          )}

          <div className="flex items-center justify-between gap-3 rounded-[28px] px-3 py-3">
            <button
              type="button"
              onClick={prevStep}
              disabled={isFirstStep || isSaving}
              className="inline-flex min-w-[112px] items-center justify-center gap-2 rounded-full border border-warm-50/80 bg-warm-50/85 px-4 py-3 text-sm font-medium text-dark shadow-[0_10px_24px_rgba(44,31,16,0.08)] transition-all duration-150 hover:-translate-y-0.5 hover:border-warm-50 hover:bg-warm-50 hover:shadow-[0_16px_32px_rgba(44,31,16,0.1)] disabled:cursor-not-allowed disabled:border-warm-50/50 disabled:bg-warm-50/55 disabled:text-muted disabled:shadow-none"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface text-muted">
                <ArrowLeft size={14} />
              </span>
              Back
            </button>

            {isLastStep ? (
              <button
                type="button"
                onClick={() => finish(false)}
                disabled={isSaving || resumeUpload.uploading}
                className="inline-flex min-w-[152px] items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-warm-50 transition-all duration-150 hover:brightness-110"
              >
                {isSaving ? 'Saving...' : 'Open dashboard'}
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-warm-50/18 text-warm-50">
                  <ArrowRight size={14} />
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={nextStep}
                disabled={isSaving || resumeUpload.uploading}
                className="inline-flex min-w-[124px] items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-warm-50 transition-all duration-150 hover:brightness-110"
              >
                Next
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-warm-50/18 text-warm-50">
                  <ArrowRight size={14} />
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
