import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Building2, FileText, Mail, RefreshCw, Upload, User } from 'lucide-react'
import Banner from '../ui/Banner'
import { createWorkspaceConfig } from '../../lib/workspaceConfig'
import { fetchPreviewFitAngle } from '../../lib/api'
import { supabase, isDemo } from '../../lib/supabase'
import { canExtractResumeText, extractResumeTextFromFile } from '../../lib/resumeText'

const TOTAL_STEPS = 3
const STEP_LABELS = ['About', 'Template', 'Gmail']

function fillVariables(content, data) {
  if (!content) return ''
  // Mirrors server-side dropEmptyTagParagraphs: when feature_line or fit_angle
  // is missing, drop the entire paragraph anchored on that tag so the preview
  // shows what production would actually ship — no orphaned "For context,
  // feels like a stepping stone…" sentences.
  const featureEmpty = !data.feature_line
  const fitEmpty = !data.fit_angle
  const trimmed = (featureEmpty || fitEmpty)
    ? content.split(/\n\s*\n/).filter(para => {
        if (featureEmpty && /\{\{(feature_line|featureLine)\}\}/.test(para)) return false
        if (fitEmpty && /\{\{(fit_angle|fitAngle)\}\}/.test(para)) return false
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
}

// Debounce delay for the preview fit-angle fetch. Long enough that users
// pasting/typing a resume don't fire a request per keystroke; short enough
// that Step 2 reflects their resume by the time they navigate to it.
const PREVIEW_DEBOUNCE_MS = 700

// Static fallback used when the preview API hasn't returned yet or returns no
// result. feature_line gets a real dossier surface. fit_angle gets a domain-
// neutral phrase so the paragraph is always visible — "your background" reads
// naturally in the template sentence without implying a specific skill set.
const PREVIEW_FALLBACK = {
  feature_line: 'claude code agentic coding',
  fit_angle: 'your background' as string | null,
} as const

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
        description="Sparrow uses this to personalize each draft so it sounds like you, not a template."
      />

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="onboarding-sender-name" className="label">Name <span className="text-red-500">*</span></label>
            <div className="relative">
              <User size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="onboarding-sender-name"
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
            <label htmlFor="onboarding-sender-role" className="label">Role</label>
            <input
              id="onboarding-sender-role"
              value={form.senderRole}
              onChange={e => updateField('senderRole', e.target.value)}
              placeholder="Founder, GTM Lead, SDR"
              className="input"
            />
          </div>
        </div>

        <div>
          <label htmlFor="onboarding-sender-company" className="label">Company</label>
          <div className="relative">
            <Building2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              id="onboarding-sender-company"
              value={form.senderCompany}
              onChange={e => updateField('senderCompany', e.target.value)}
              placeholder="Cornell Generative AI"
              className="input pl-8"
            />
          </div>
        </div>

        <div>
          <textarea
            aria-label="Relevant experience"
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
            aria-label="Upload resume or bio"
            type="file"
            accept=".pdf,.docx,.txt"
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

const MERGE_TAGS: ReadonlyArray<{ tag: string; label: string }> = [
  { tag: '{{first_name}}',  label: 'first name' },
  { tag: '{{last_name}}',   label: 'last name' },
  { tag: '{{company}}',     label: 'company' },
  { tag: '{{role}}',        label: 'role' },
  { tag: '{{sender_name}}', label: 'your name' },
  { tag: '{{feature_line}}', label: 'feature line' },
  { tag: '{{fit_angle}}',   label: 'fit angle' },
]

function TemplateStep({ form, templates, selectedTemplate, updateField, updateCustomTemplate, setTemplateMode, aiPreview, isLoadingPreview }) {
  const hasTemplates = templates.length > 0
  const writingMode = !hasTemplates || form.templateMode !== 'existing'
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [activeField, setActiveField] = useState<'subject' | 'body'>('body')

  const previewData = {
    first_name: 'Dario',
    last_name: 'Amodei',
    company: 'Anthropic',
    role: 'CEO',
    sender_name: form.senderName || 'Your Name',
    feature_line: aiPreview.featureLine ?? (isLoadingPreview ? '…' : PREVIEW_FALLBACK.feature_line),
    fit_angle: aiPreview.fitAngle ?? (isLoadingPreview ? '…' : PREVIEW_FALLBACK.fit_angle),
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
              <label htmlFor="onboarding-existing-template" className="label">Template</label>
              <div className="relative">
                <FileText size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <select
                  id="onboarding-existing-template"
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

function GmailStep({
  hasGoogle,
  profileLoading,
  isConnecting,
  connectError,
  onConnectGoogle,
  onRefreshProfile,
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <StepHeader
        step={3}
        total={TOTAL_STEPS}
        title="Connect Gmail"
        description="Grant send permission so Sparrow can send approved drafts from your account."
      />

      <div className="rounded-2xl border border-warm-200 bg-warm-50/70 px-5 py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${hasGoogle ? 'bg-emerald-50 text-emerald-600' : 'bg-warm-100 text-muted'}`}>
              <Mail size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-dark">{hasGoogle ? 'Gmail connected' : 'Gmail not connected'}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted">
                {hasGoogle ? 'You can send drafts after reviewing them.' : 'You will review drafts before anything is sent.'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!hasGoogle && (
              <button
                type="button"
                onClick={onConnectGoogle}
                disabled={isConnecting}
                className="btn-primary text-xs"
              >
                {isConnecting ? 'Connecting...' : 'Connect Gmail'}
              </button>
            )}
            <button
              type="button"
              onClick={onRefreshProfile}
              disabled={profileLoading}
              className="btn-ghost text-xs"
              title="Refresh Gmail status"
            >
              <RefreshCw size={12} className={profileLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {connectError && (
        <Banner variant="danger" className="mt-4">{connectError}</Banner>
      )}
    </div>
  )
}

function normalizeStepIndex(index) {
  return Number.isInteger(index) ? Math.max(0, Math.min(TOTAL_STEPS - 1, index)) : 0
}

export default function OnboardingScreen({
  user,
  templates,
  initialData,
  profile,
  profileLoading,
  onRefreshProfile,
  onConnectGoogle,
  initialStepIndex = 0,
  onSaveDraft,
  onSaveProgress,
  onFinishLater,
  onSaveForConnect,
  onComplete,
  onLogout,
}) {
  const [stepIndex, setStepIndex] = useState(() => normalizeStepIndex(initialStepIndex))
  const [senderNameAttempted, setSenderNameAttempted] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [connectError, setConnectError] = useState('')
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

  // Preview personalization — fetched here (not inside TemplateStep) so the
  // debounce starts while the user is still on step 1 filling in their resume.
  // By the time they navigate to step 2 the result is usually ready.
  const [aiPreview, setAiPreview] = useState<{ featureLine: string | null; fitAngle: string | null }>({
    featureLine: null,
    fitAngle: null,
  })
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)

  useEffect(() => {
    const text = (form.resumeText || '').trim()
    if (text.length === 0) {
      setAiPreview({ featureLine: null, fitAngle: null })
      setIsLoadingPreview(false)
      return
    }
    setIsLoadingPreview(true)
    let cancelled = false
    const timer = setTimeout(() => {
      fetchPreviewFitAngle(text)
        .then(res => {
          if (cancelled) return
          setAiPreview({ featureLine: res?.featureLine ?? null, fitAngle: res?.fitAngle ?? null })
          setIsLoadingPreview(false)
        })
        .catch((err) => {
          console.error('[preview] fetchPreviewFitAngle failed:', err)
          if (!cancelled) {
            setAiPreview({ featureLine: null, fitAngle: null })
            setIsLoadingPreview(false)
          }
        })
    }, PREVIEW_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [form.resumeText])

  const saveDraftMounted = useRef(false)
  useEffect(() => {
    if (!saveDraftMounted.current) { saveDraftMounted.current = true; return }
    onSaveDraft?.(form)
  }, [form, onSaveDraft])

  useEffect(() => {
    const nextStepIndex = normalizeStepIndex(initialStepIndex)
    if (nextStepIndex > 0) setStepIndex(nextStepIndex)
  }, [initialStepIndex])

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
  const handleUploadResume = async (file) => {
    if (!file) return
    setResumeUpload({ uploading: true, error: null })
    if (file.size > 10 * 1024 * 1024) {
      setResumeUpload({ uploading: false, error: 'File must be under 10 MB.' })
      return
    }

    if (!canExtractResumeText(file)) {
      setResumeUpload({ uploading: false, error: 'Upload a PDF, DOCX, or TXT resume so Sparrow can read it.' })
      return
    }

    let extractedResumeText = ''
    try {
      extractedResumeText = await extractResumeTextFromFile(file)
    } catch {
      extractedResumeText = ''
    }
    if (!extractedResumeText && !form.resumeText?.trim()) {
      setResumeUpload({ uploading: false, error: 'Could not read text from this resume. Try a text-based PDF, DOCX, or TXT file.' })
      return
    }

    if (isDemo || !user?.id) {
      markUserEdited()
      setForm(current => ({
        ...current,
        resumeText: current.resumeText?.trim() ? current.resumeText : extractedResumeText,
        resumeFileName: file.name,
        resumePath: '',
        resumeUploadedAt: new Date().toISOString(),
      }))
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
    setForm(current => ({
      ...current,
      resumeText: current.resumeText?.trim() ? current.resumeText : extractedResumeText,
      resumeFileName: file.name,
      resumePath: path,
      resumeUploadedAt: new Date().toISOString(),
    }))
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

  const isSenderNameValid = Boolean(form.senderName.trim())

  const persistCurrentProgress = async () => {
    setSaveError('')
    setIsSaving(true)
    try {
      const payload = {
        ...form,
        templateId: form.templateMode === 'custom' ? '' : selectedTemplate?.id || '',
        skipped: false,
      }
      await onSaveProgress?.(payload)
      return true
    } catch (err) {
      setSaveError(err.message || 'Setup could not be saved. Try again.')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const nextStep = async () => {
    if (stepIndex === 0 && !isSenderNameValid) {
      setSenderNameAttempted(true)
      return
    }
    if (stepIndex < steps.length - 1) {
      if (isSaving || resumeUpload.uploading) return
      const saved = await persistCurrentProgress()
      if (!saved) return
    }
    setStepIndex(index => Math.min(index + 1, steps.length - 1))
  }
  const prevStep = () => setStepIndex(index => Math.max(index - 1, 0))
  const goToStep = async (index) => {
    if (index > 0 && !isSenderNameValid) {
      setSenderNameAttempted(true)
      setStepIndex(0)
      return
    }
    if (stepIndex < steps.length - 1 && index > stepIndex) {
      if (isSaving || resumeUpload.uploading) return
      const saved = await persistCurrentProgress()
      if (!saved) return
    }
    setStepIndex(index)
  }

  const finish = async (skipped = false) => {
    if (isSaving || resumeUpload.uploading) return false

    setSaveError('')
    setIsSaving(true)
    try {
      const payload = {
        ...form,
        templateId: form.templateMode === 'custom' ? '' : selectedTemplate?.id || '',
        skipped,
      }
      if (skipped) {
        await onFinishLater?.(payload)
      } else {
        await onComplete?.(payload)
      }
      return true
    } catch (err) {
      setSaveError(err.message || 'Setup could not be saved. Try again.')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const finishAndConnectGoogle = async () => {
    if (isConnecting || isSaving || resumeUpload.uploading) return
    setConnectError('')
    setIsConnecting(true)
    try {
      const payload = {
        ...form,
        templateId: form.templateMode === 'custom' ? '' : selectedTemplate?.id || '',
        skipped: false,
      }
      await onSaveForConnect?.(payload)
      const res = await onConnectGoogle?.()
      if (res?.error?.message) setConnectError(res.error.message)
    } catch (err) {
      setConnectError(err.message || 'Gmail connection could not start.')
    } finally {
      setIsConnecting(false)
    }
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
    <TemplateStep
      key="template"
      form={form}
      templates={templates}
      selectedTemplate={selectedTemplate}
      updateField={updateField}
      updateCustomTemplate={updateCustomTemplate}
      setTemplateMode={setTemplateMode}
      aiPreview={aiPreview}
      isLoadingPreview={isLoadingPreview}
    />,
    <GmailStep
      key="gmail"
      hasGoogle={!!profile?.hasGoogleRefreshToken}
      profileLoading={profileLoading}
      isConnecting={isConnecting}
      connectError={connectError}
      onConnectGoogle={finishAndConnectGoogle}
      onRefreshProfile={onRefreshProfile}
    />,
  ]

  const isFirstStep = stepIndex === 0
  const isLastStep = stepIndex === steps.length - 1
  const contentWidthClass = 'max-w-2xl'

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
                onClick={profile?.hasGoogleRefreshToken ? () => finish(false) : finishAndConnectGoogle}
                disabled={isSaving || isConnecting || resumeUpload.uploading}
                className="inline-flex min-w-[152px] items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-warm-50 transition-all duration-150 hover:brightness-110"
              >
                {isSaving || isConnecting ? 'Saving...' : profile?.hasGoogleRefreshToken ? 'Open dashboard' : 'Connect Gmail'}
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
