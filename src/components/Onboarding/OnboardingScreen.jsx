import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Building2, FileText, Key,
  LogOut,
  Sparkles,
  Target, Upload, User,
} from 'lucide-react'
import { createWorkspaceConfig } from '../../lib/workspaceConfig'
import { supabase, isDemo } from '../../lib/supabase'

const TOTAL_STEPS = 6
const LEAD_PRESETS = [25, 50, 100, 250]

const API_FIELDS = [
  {
    id: 'openai',
    label: 'OpenAI API key',
    placeholder: 'sk-...',
  },
  {
    id: 'claude',
    label: 'Claude API key',
    placeholder: 'Anthropic API key',
  },
  {
    id: 'gemini',
    label: 'Gemini API key',
    placeholder: 'Google AI Studio key',
  },
  {
    id: 'apollo',
    label: 'Lead source key',
    placeholder: 'Apollo or enrichment provider key',
  },
  {
    id: 'serper',
    label: 'Research API key',
    placeholder: 'Serper or research provider key',
  },
]

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
  return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function StepHeader({ step, total, title, description }) {
  return (
    <div className="mb-6 text-center sm:mb-8">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
        Step {step} of {total}
      </p>
      <h1 className="mt-3 text-2xl font-display font-semibold text-dark sm:text-3xl">{title}</h1>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">{description}</p>
    </div>
  )
}

function WelcomeStep({ name }) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="relative mb-8 flex justify-center sm:mb-10">
        <div className="animate-welcome-breathe absolute top-4 h-28 w-28 rounded-full bg-primary/15 blur-3xl sm:h-36 sm:w-36" />
        <div className="animate-welcome-float relative flex h-24 w-24 items-center justify-center rounded-full bg-primary text-white sm:h-28 sm:w-28">
          <Sparkles size={28} className="animate-welcome-twinkle sm:h-8 sm:w-8" />
        </div>

        <div
          className="animate-welcome-float absolute left-[calc(50%-88px)] top-5 h-2.5 w-2.5 rounded-full bg-primary/35"
          style={{ animationDelay: '0.7s' }}
        />
        <div
          className="animate-welcome-float absolute left-[calc(50%+76px)] top-16 h-3 w-3 rounded-full bg-sky-300/70"
          style={{ animationDelay: '1.3s' }}
        />
        <div
          className="animate-welcome-float absolute left-[calc(50%-72px)] top-20"
          style={{ animationDelay: '1.8s' }}
        >
          <Sparkles size={14} className="text-primary/70" />
        </div>
      </div>

      <div className="animate-welcome-rise" style={{ animationDelay: '80ms' }}>
        <StepHeader
          step={1}
          total={TOTAL_STEPS}
          title={name ? `Welcome, ${name}` : 'Welcome'}
          description="This takes about a minute."
        />
      </div>

      <div className="space-y-5 text-center">
        <p
          className="animate-welcome-rise mx-auto max-w-xl text-base leading-8 text-dark sm:text-lg"
          style={{ animationDelay: '180ms' }}
        >
          Let&apos;s get your workspace ready so Coldflow feels personal from the start.
        </p>
      </div>
    </div>
  )
}

function ResumeStep({ form, updateField, onUploadResume, uploadState }) {
  const statusLabel = uploadState.uploading
    ? 'Uploading…'
    : uploadState.error
      ? `Upload failed: ${uploadState.error}`
      : form.resumeFileName || 'Upload a resume file'

  return (
    <div className="mx-auto w-full max-w-2xl">
      <StepHeader
        step={2}
        total={TOTAL_STEPS}
        title="Add your background"
        description="Give the AI enough context to write outbound emails in your voice."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="p-1">
          <label className="label">Paste resume or bio</label>
          <textarea
            value={form.resumeText}
            onChange={e => updateField('resumeText', e.target.value)}
            placeholder="Founder bio, resume highlights, offer, target market..."
            className="input min-h-[140px] resize-none bg-white"
          />
        </div>

        <label className="flex cursor-pointer flex-col justify-between rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-4 transition-colors hover:border-primary/50 hover:bg-primary/10">
          <div>
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-primary shadow-card">
              <Upload size={18} />
            </div>
            <p className="text-sm font-medium text-dark">
              {statusLabel}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted">
              PDF, DOCX, or TXT. This is optional if you already pasted context.
            </p>
          </div>

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

function SenderStep({ form, updateField, showNameError }) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <StepHeader
        step={3}
        total={TOTAL_STEPS}
        title="Set the sender identity"
        description="These details shape signatures, personalization, and the perspective the assistant writes from."
      />

      <div className="space-y-4">
        <div>
          <label className="label">
            Name <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <User size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={form.senderName}
              onChange={e => updateField('senderName', e.target.value)}
              placeholder="Sheldon J. Plankton"
              className={`input pl-8 ${showNameError ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''}`}
              aria-invalid={showNameError}
            />
          </div>
          {showNameError && (
            <p className="mt-2 text-xs text-red-500">Sender name is required to continue.</p>
          )}
        </div>

        <div>
          <label className="label">Company</label>
          <div className="relative">
            <Building2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={form.senderCompany}
              onChange={e => updateField('senderCompany', e.target.value)}
              placeholder="The Chum Bucket"
              className="input pl-8"
            />
          </div>
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
    </div>
  )
}

function TemplateStep({
  form,
  templates,
  selectedTemplate,
  updateField,
  updateCustomTemplate,
  setTemplateMode,
}) {
  const previewData = {
    first_name: 'Alex',
    last_name: 'Chen',
    company: 'Momentum AI',
    role: 'Co-founder & CEO',
    sender_name: form.senderName || 'Your Name',
  }
  const previewTemplate = form.templateMode === 'custom'
    ? form.customTemplate
    : selectedTemplate

  return (
    <div className="mx-auto w-full max-w-5xl">
      <StepHeader
        step={4}
        total={TOTAL_STEPS}
        title="Choose a starting template"
        description="Pick one template now. You can rewrite or swap it later in the templates tab."
      />

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setTemplateMode('existing')}
          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            form.templateMode === 'existing'
              ? 'bg-primary text-white'
              : 'bg-white text-muted border border-gray-200 hover:text-dark'
          }`}
        >
          Use existing
        </button>
        <button
          type="button"
          onClick={() => setTemplateMode('custom')}
          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            form.templateMode === 'custom'
              ? 'bg-primary text-white'
              : 'bg-white text-muted border border-gray-200 hover:text-dark'
          }`}
        >
          Make custom
        </button>
      </div>

      {form.templateMode === 'existing' ? (
        <div className="space-y-4">
          <div className="p-1">
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

          <div className="overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">Preview</p>
              <p className="mt-1 text-sm font-medium text-dark">
                {previewTemplate?.subject ? fillVariables(previewTemplate.subject, previewData) : 'No template selected'}
              </p>
            </div>
            <div className="px-4 py-4 text-sm leading-7 text-dark">
              {previewTemplate?.body ? stripHtml(fillVariables(previewTemplate.body, previewData)) : 'Select or create a template to preview it.'}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <div className="space-y-3 p-1">
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
                value={form.customTemplate.subject}
                onChange={e => updateCustomTemplate('subject', e.target.value)}
                placeholder="Quick thought about {{company}}"
                className="input"
              />
            </div>
            <div>
              <label className="label">Body</label>
              <textarea
                value={form.customTemplate.body}
                onChange={e => updateCustomTemplate('body', e.target.value)}
                placeholder={"Hi {{first_name}},\n\nWanted to reach out because...\n\nBest,\n{{sender_name}}"}
                className="input min-h-[220px] resize-none"
              />
            </div>
          </div>

          <div className="overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">Preview</p>
              <p className="mt-1 text-sm font-medium text-dark">
                {previewTemplate?.subject ? fillVariables(previewTemplate.subject, previewData) : 'No template selected'}
              </p>
            </div>
            <div className="px-4 py-4 text-sm leading-7 text-dark">
              {previewTemplate?.body ? stripHtml(fillVariables(previewTemplate.body, previewData)) : 'Select or create a template to preview it.'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LeadsStep({ form, updateField }) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <StepHeader
        step={5}
        total={TOTAL_STEPS}
        title="Choose your prospect count"
        description="A lead is a person or company you may want to contact. Pick how many new prospects ColdFlow should generate per run."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {LEAD_PRESETS.map(value => (
          <button
            key={value}
            type="button"
            onClick={() => updateField('leadsPerGeneration', value)}
            className={`rounded-2xl border px-4 py-5 text-left transition-colors ${
              form.leadsPerGeneration === value
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-gray-100 bg-white text-dark hover:border-primary/30 hover:bg-gray-50'
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">New prospects per run</p>
            <p className="mt-2 text-2xl font-display font-semibold">{value}</p>
          </button>
        ))}
      </div>

      <div className="mt-4 p-1">
        <label className="label">Custom prospect count</label>
        <div className="relative max-w-[180px]">
          <Target size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="number"
            min={1}
            max={1000}
            value={form.leadsPerGeneration}
            onChange={e => updateField('leadsPerGeneration', Math.max(1, Number(e.target.value) || 1))}
            className="input pl-8"
          />
        </div>
      </div>
    </div>
  )
}

function ApiKeysStep({ form, updateApiKey }) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <StepHeader
        step={6}
        total={TOTAL_STEPS}
        title="Add API keys"
        description="Optional for now, but this is where AI, research, and lead-source providers connect."
      />

      <div className="space-y-4">
        {API_FIELDS.map(field => (
          <div key={field.id}>
            <label className="label">{field.label}</label>
            <div className="relative">
              <Key size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="password"
                value={form.apiKeys[field.id]}
                onChange={e => updateApiKey(field.id, e.target.value)}
                placeholder={field.placeholder}
                className="input pl-8"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function OnboardingScreen({
  user,
  templates,
  initialData,
  onSaveDraft,
  onComplete,
  onLogout,
}) {
  const [stepIndex, setStepIndex] = useState(0)
  const [senderNameAttempted, setSenderNameAttempted] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [resumeUpload, setResumeUpload] = useState({ uploading: false, error: null })
  const [form, setForm] = useState(() => {
    const config = createWorkspaceConfig({ user, templates, data: initialData })

    return {
      ...config,
      customTemplate: {
        ...config.customTemplate,
        body: stripHtml(config.customTemplate.body || ''),
      },
    }
  })

  // Skip firing onSaveDraft on the initial mount to avoid overwriting the
  // server-synced profile that AppShell may still be fetching concurrently.
  const saveDraftMounted = useRef(false)
  useEffect(() => {
    if (!saveDraftMounted.current) { saveDraftMounted.current = true; return }
    onSaveDraft?.(form)
  }, [form, onSaveDraft])

  useEffect(() => {
    if (form.senderName.trim()) {
      setSenderNameAttempted(false)
    }
  }, [form.senderName])

  const selectedTemplate = useMemo(
    () => templates.find(template => template.id === form.templateId) || templates[0] || null,
    [form.templateId, templates]
  )

  const updateField = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const updateCustomTemplate = (key, value) => setForm(current => ({
    ...current,
    customTemplate: {
      ...current.customTemplate,
      [key]: value,
    },
  }))
  const updateApiKey = (key, value) => setForm(current => ({
    ...current,
    apiKeys: {
      ...current.apiKeys,
      [key]: value,
    },
  }))
  const handleUploadResume = async (file) => {
    if (!file) return
    setResumeUpload({ uploading: true, error: null })

    if (isDemo || !user?.id) {
      // Demo mode: just record the filename so the UX still works.
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

    setForm(current => ({ ...current, resumeFileName: file.name, resumePath: path }))
    setResumeUpload({ uploading: false, error: null })
  }

  const setTemplateMode = (mode) => {
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
    <WelcomeStep key="welcome" name={form.senderName || user?.user_metadata?.full_name || ''} />,
    <ResumeStep
      key="resume"
      form={form}
      updateField={updateField}
      onUploadResume={handleUploadResume}
      uploadState={resumeUpload}
    />,
    <SenderStep
      key="sender"
      form={form}
      updateField={updateField}
      showNameError={stepIndex === 2 && senderNameAttempted && !form.senderName.trim()}
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
    <LeadsStep key="leads" form={form} updateField={updateField} />,
    <ApiKeysStep key="keys" form={form} updateApiKey={updateApiKey} />,
  ]

  const isFirstStep = stepIndex === 0
  const isLastStep = stepIndex === steps.length - 1
  const contentWidthClass = stepIndex === 3 ? 'max-w-5xl' : 'max-w-3xl'
  const isSenderNameValid = Boolean(form.senderName.trim())

  const nextStep = () => {
    if (stepIndex === 2 && !isSenderNameValid) {
      setSenderNameAttempted(true)
      return
    }
    setStepIndex(index => Math.min(index + 1, steps.length - 1))
  }
  const prevStep = () => setStepIndex(index => Math.max(index - 1, 0))
  const goToStep = (index) => {
    if (index > 2 && !isSenderNameValid) {
      setSenderNameAttempted(true)
      setStepIndex(2)
      return
    }

    setStepIndex(index)
  }

  const finish = (skipped = false) => {
    onComplete({
      ...form,
      templateId: selectedTemplate?.id || '',
      skipped,
    })
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
          <div className="flex items-start gap-3 sm:gap-4">
            <button
              type="button"
              onClick={handleLogout}
              disabled={isSigningOut}
              className="-ml-2 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-muted transition-all duration-150 hover:-translate-y-0.5  hover:text-dark disabled:cursor-not-allowed disabled:opacity-50 sm:-ml-5 lg:-ml-8"
            >
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>

            <div>
              <p className="text-sm font-display font-semibold tracking-[0.12em] text-dark">ColdFlow</p>
              <p className="mt-1 text-sm text-muted">Onboarding</p>
            </div>
          </div>
          <button type="button" onClick={() => finish(true)} className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-muted transition-all duration-150 hover:-translate-y-0.5 hover:text-dark disabled:cursor-not-allowed disabled:opacity-50">
            Skip
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
                aria-label={`Go to step ${index + 1}`}
                className={`h-2.5 rounded-full transition-all ${
                  index === stepIndex ? 'w-8 bg-primary' : 'w-2.5 bg-gray-300 hover:bg-gray-400'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-[28px] px-3 py-3">
            <button
              type="button"
              onClick={prevStep}
              disabled={isFirstStep}
              className="inline-flex min-w-[112px] items-center justify-center gap-2 rounded-full border border-white/80 bg-white/85 px-4 py-3 text-sm font-medium text-dark shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-all duration-150 hover:-translate-y-0.5 hover:border-white hover:bg-white hover:shadow-[0_16px_32px_rgba(15,23,42,0.1)] disabled:cursor-not-allowed disabled:border-white/50 disabled:bg-white/55 disabled:text-muted disabled:shadow-none"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <ArrowLeft size={14} />
              </span>
              Back
            </button>

            <p className="hidden text-sm text-muted sm:block">
              Everything here can be edited later.
            </p>

            {isLastStep ? (
              <button
                type="button"
                onClick={() => finish(false)}
                className="inline-flex min-w-[152px] items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-white transition-all duration-150 hover:brightness-110"
              >
                Enter dashboard
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/18 text-white">
                  <ArrowRight size={14} />
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={nextStep}
                className="inline-flex min-w-[124px] items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-white transition-all duration-150 hover:brightness-110"
              >
                Next
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/18 text-white">
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
