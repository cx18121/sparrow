import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Building2, ClipboardList, FileText,
  LogOut,
  SlidersHorizontal, Upload, User,
} from 'lucide-react'
import { createWorkspaceConfig } from '../../lib/workspaceConfig'
import { supabase, isDemo } from '../../lib/supabase'

const TOTAL_STEPS = 4
const STEP_LABELS = ['Background', 'Sender', 'Style', 'Template']

const STYLE_TESTS = [
  {
    id: 'tone',
    label: 'Tone',
    dimension: 'Choose the voice that feels more natural for you.',
    a: {
      label: 'Straightforward',
      traits: { directness: 3, warmth: 0, brevity: 1, specificity: 0, polish: 0 },
      body: 'Noticed {{company}} is working in a space where targeted outreach and timing matter.\n\nI am building a lightweight workflow that turns public company signals into cleaner first drafts, without making the message feel automated.\n\nWorth sending over a quick example?',
    },
    b: {
      label: 'Warm',
      traits: { directness: 0, warmth: 3, brevity: 0, specificity: 0, polish: 1 },
      body: 'I came across {{company}} while looking at teams doing thoughtful work in this market, and your focus stood out.\n\nI have been exploring how small teams can make first-touch outreach feel more researched without adding hours of manual writing.\n\nWould it be useful if I shared the short version?',
    },
  },
  {
    id: 'length',
    label: 'Length',
    dimension: 'Choose how much context you want before the ask.',
    a: {
      label: 'Concise',
      traits: { directness: 1, warmth: 0, brevity: 3, specificity: 0, polish: 0 },
      body: 'Noticed {{company}} and thought my work on research-backed cold outreach might be relevant.\n\nCould I send over a quick example?',
    },
    b: {
      label: 'Contextual',
      traits: { directness: 0, warmth: 1, brevity: 0, specificity: 3, polish: 1 },
      body: 'I noticed {{company}} while looking at teams where trust and timing seem important in outbound.\n\nMy recent work focuses on turning scattered prospect research into short, specific first drafts, especially when there is only one useful company signal to work from.\n\nIf helpful, I can send a brief example using a public signal from your site.',
    },
  },
  {
    id: 'ask',
    label: 'Ask',
    dimension: 'Choose the kind of call to action you prefer.',
    a: {
      label: 'Specific ask',
      traits: { directness: 3, warmth: 0, brevity: 1, specificity: 1, polish: 0 },
      body: 'I noticed {{company}} and thought there may be a useful fit with my work on making cold outreach more specific and less manual.\n\nWould you be open to a 15-minute conversation next week so I can show you what I am building?',
    },
    b: {
      label: 'Soft ask',
      traits: { directness: 0, warmth: 3, brevity: 0, specificity: 0, polish: 1 },
      body: 'I noticed {{company}} and thought there may be a useful fit with my work on making first-touch emails more relevant.\n\nNo need to book time yet. Would it be helpful if I sent over the 3-line version first?',
    },
  },
  {
    id: 'personalization',
    label: 'Personalization',
    dimension: 'Choose how much research detail should appear in the first note.',
    a: {
      label: 'Light',
      traits: { directness: 1, warmth: 0, brevity: 2, specificity: 0, polish: 0 },
      body: 'I saw {{company}} and thought there could be a useful reason to connect.\n\nI am working on a tool that helps students turn lead research into reviewed first drafts faster.\n\nWorth sharing?',
    },
    b: {
      label: 'Specific',
      traits: { directness: 0, warmth: 0, brevity: 0, specificity: 3, polish: 1 },
      body: 'I noticed {{company}} is in a market where a generic first email would probably get ignored. That caught my attention because my recent work is about using public company signals to write a more relevant first draft.\n\nWould a short example using one signal from {{company}} be useful?',
    },
  },
]

const STYLE_LABELS = {
  directness: 'direct',
  warmth: 'warm',
  brevity: 'concise',
  specificity: 'specific',
  polish: 'polished',
}

const DEFAULT_STYLE_PROFILE = {
  name: 'Balanced outreach',
  summary: 'Concise, clear, and easy to edit.',
  prompt: 'Write concise, clear outreach with a specific reason for contact and one low-friction ask.',
  traits: ['direct', 'concise', 'specific'],
  scores: { directness: 1, warmth: 1, brevity: 1, specificity: 1, polish: 1 },
}

const STYLE_PROMPTS = {
  direct: 'Use direct language. State the reason for reaching out early and include a clear ask.',
  warm: 'Use a warm but professional tone. Keep the message human without adding filler.',
  concise: 'Keep the email short. Prefer 70 to 100 words and remove unnecessary setup.',
  specific: 'Include one concrete relevance signal about the company or recipient. Do not invent facts.',
  polished: 'Keep phrasing professional and composed. Avoid slang, hype, and overfamiliar language.',
}

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

function scoreStyleChoices(choices = {}) {
  const scores = { directness: 0, warmth: 0, brevity: 0, specificity: 0, polish: 0 }

  STYLE_TESTS.forEach(test => {
    const pick = choices[test.id]
    const option = pick ? test[pick] : null
    if (!option) return

    Object.entries(option.traits).forEach(([trait, value]) => {
      scores[trait] = (scores[trait] || 0) + value
    })
  })

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const topTraits = ranked.filter(([, value]) => value > 0).slice(0, 3).map(([trait]) => STYLE_LABELS[trait])
  const prompt = topTraits.length
    ? topTraits.map(trait => STYLE_PROMPTS[trait]).filter(Boolean).join(' ')
    : DEFAULT_STYLE_PROFILE.prompt

  return {
    name: topTraits.length ? `${topTraits.map(t => t[0].toUpperCase() + t.slice(1)).join(', ')} outreach` : DEFAULT_STYLE_PROFILE.name,
    summary: topTraits.length
      ? `Your drafts should feel ${topTraits.join(', ')}.`
      : DEFAULT_STYLE_PROFILE.summary,
    prompt,
    traits: topTraits.length ? topTraits : DEFAULT_STYLE_PROFILE.traits,
    scores,
  }
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

function StepHeader({ step, total, title, description }) {
  return (
    <div className="mb-6 text-center sm:mb-7">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
        {STEP_LABELS[step - 1]} - Step {step} of {total}
      </p>
      <h1 className="mt-3 text-2xl font-display font-semibold text-dark sm:text-3xl">{title}</h1>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">{description}</p>
    </div>
  )
}

function ResumeStep({ form, updateField, onUploadResume, uploadState }) {
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
        title="Add background"
        description="Add the details Coldflow should use when writing in your voice."
      />

      <div className="space-y-4">
        <div>
          <label className="label">Paste resume or bio</label>
          <textarea
            value={form.resumeText}
            onChange={e => updateField('resumeText', e.target.value)}
            placeholder="Relevant experience, club role, offer, target audience, recent work..."
            className="input min-h-[180px] resize-none bg-white"
          />
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-3 transition-colors hover:border-primary/40 hover:bg-primary/5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-dark">
              {statusLabel}
            </p>
            <p className="mt-1 text-xs text-muted">
              Optional: PDF, DOCX, or TXT.
            </p>
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

function SenderStep({ form, updateField, showNameError }) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <StepHeader
        step={2}
        total={TOTAL_STEPS}
        title="Set sender"
        description="Choose the name and role that should appear in drafts."
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
              placeholder="Maya Chen"
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
              placeholder="Cornell Generative AI"
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
    <div className="mx-auto w-full max-w-6xl">
      <StepHeader
        step={3}
        total={TOTAL_STEPS}
        title="Pick your email style"
        description="Choose the sample you would rather send. Coldflow turns your picks into an editable template."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                Comparison {activeIndex + 1} of {STYLE_TESTS.length}
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
                        : 'w-2.5 bg-slate-300'
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
                  className={`flex min-h-[300px] flex-col rounded-2xl border px-5 py-4 text-left transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-[0_14px_32px_rgba(27,110,243,0.12)]'
                      : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card'
                  }`}
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Option {key.toUpperCase()}</p>
                      <p className="mt-1 text-base font-semibold text-dark">{option.label}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      isSelected ? 'bg-primary text-white' : 'bg-slate-100 text-muted'
                    }`}>
                      {isSelected ? 'Selected' : 'Pick'}
                    </span>
                  </div>
                  <p className="whitespace-pre-line text-sm leading-6 text-dark">
                    {fillVariables(option.body, sampleData)}
                  </p>
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {showMissing && completed < STYLE_TESTS.length ? (
              <p className="text-xs font-medium text-red-500">Pick one option for each comparison before continuing.</p>
            ) : (
              <p className="text-xs text-muted">You can revise any pick before generating the template.</p>
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

        <aside className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <SlidersHorizontal size={17} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Style profile</p>
              <p className="text-sm font-semibold text-dark">{completed} of {STYLE_TESTS.length} picked</p>
            </div>
          </div>

          <p className="text-sm leading-6 text-dark">{profile.summary}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {profile.traits.map(trait => (
              <span key={trait} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                {trait}
              </span>
            ))}
          </div>

          <div className="mt-5 space-y-2">
            {STYLE_TESTS.map((test, index) => {
              const pick = form.styleChoices?.[test.id]
              return (
                <button
                  key={test.id}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-50"
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
  const hasTemplates = templates.length > 0

  return (
    <div className="mx-auto w-full max-w-5xl">
      <StepHeader
        step={4}
        total={TOTAL_STEPS}
        title="Review template"
        description="Edit the generated template or use a saved one instead."
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
          Use saved template
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
          Write template
        </button>
      </div>

      {form.templateMode === 'existing' ? (
        <div className="space-y-4">
          {hasTemplates ? (
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
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <ClipboardList size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-dark">No templates yet</p>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    Write one now so new drafts have a starting structure.
                  </p>
                  <button type="button" onClick={() => setTemplateMode('custom')} className="mt-4 btn-primary">
                    Write first template
                  </button>
                </div>
              </div>
            </div>
          )}

          {hasTemplates && (
            <div className="overflow-hidden">
              <div className="border-b border-gray-100 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">Preview</p>
                <p className="mt-1 text-sm font-medium text-dark">
                  {previewTemplate?.subject ? fillVariables(previewTemplate.subject, previewData) : 'No template selected'}
                </p>
              </div>
              <div className="px-4 py-4 text-sm leading-7 text-dark">
                {previewTemplate?.body ? stripHtml(fillVariables(previewTemplate.body, previewData)) : 'Choose or write a template to preview it.'}
              </div>
            </div>
          )}
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
                {previewTemplate?.body ? stripHtml(fillVariables(previewTemplate.body, previewData)) : 'Choose or write a template to preview it.'}
            </div>
          </div>
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
  onComplete,
  onLogout,
}) {
  const [stepIndex, setStepIndex] = useState(0)
  const [senderNameAttempted, setSenderNameAttempted] = useState(false)
  const [styleAttempted, setStyleAttempted] = useState(false)
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

  useEffect(() => {
    if (STYLE_TESTS.every(test => form.styleChoices?.[test.id])) {
      setStyleAttempted(false)
    }
  }, [form.styleChoices])

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
  const updateStyleChoice = (testId, choice) => {
    setForm(current => {
      const styleChoices = {
        ...(current.styleChoices || {}),
        [testId]: choice,
      }
      const styleProfile = scoreStyleChoices(styleChoices)
      return withGeneratedStyleTemplate({
        ...current,
        styleChoices,
        styleProfile,
      })
    })
  }
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
      showNameError={stepIndex === 1 && senderNameAttempted && !form.senderName.trim()}
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
  const contentWidthClass = stepIndex >= 2 ? 'max-w-6xl' : 'max-w-3xl'
  const isSenderNameValid = Boolean(form.senderName.trim())
  const isStyleComplete = STYLE_TESTS.every(test => form.styleChoices?.[test.id])

  const nextStep = () => {
    if (stepIndex === 1 && !isSenderNameValid) {
      setSenderNameAttempted(true)
      return
    }
    if (stepIndex === 2) {
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
    if (index > 1 && !isSenderNameValid) {
      setSenderNameAttempted(true)
      setStepIndex(1)
      return
    }
    if (index > 2 && !isStyleComplete) {
      setStyleAttempted(true)
      setStepIndex(2)
      return
    }
    if (index === 3) {
      setForm(current => withGeneratedStyleTemplate(current, { force: true }))
    }

    setStepIndex(index)
  }

  const finish = (skipped = false) => {
    const needsGeneratedTemplate = !skipped && (
      (form.templateMode === 'custom' && (!form.customTemplate?.subject || !form.customTemplate?.body))
      || (form.templateMode !== 'custom' && !selectedTemplate)
    )
    const finalForm = needsGeneratedTemplate ? withGeneratedStyleTemplate(form, { force: true }) : form

    onComplete({
      ...finalForm,
      templateId: finalForm.templateMode === 'custom' ? '' : selectedTemplate?.id || '',
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
              <p className="text-sm font-display font-semibold tracking-[0.12em] text-dark">Coldflow</p>
              <p className="mt-1 text-sm text-muted">Setup</p>
            </div>
          </div>
          <button type="button" onClick={() => finish(true)} className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-muted transition-all duration-150 hover:-translate-y-0.5 hover:text-dark disabled:cursor-not-allowed disabled:opacity-50">
            Finish later
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
                  index === stepIndex ? 'bg-primary/10' : 'hover:bg-white/76'
                }`}
              >
                <span className={`h-2.5 rounded-full transition-all ${
                  index === stepIndex ? 'w-8 bg-primary' : 'w-2.5 bg-slate-300 group-hover:bg-slate-400'
                }`} />
                <span className={`hidden pl-2 pr-2 text-xs font-medium sm:inline ${
                  index === stepIndex ? 'text-primary' : 'text-muted'
                }`}>
                  {STEP_LABELS[index]}
                </span>
              </button>
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

            {isLastStep ? (
              <button
                type="button"
                onClick={() => finish(false)}
                className="inline-flex min-w-[152px] items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-medium text-white transition-all duration-150 hover:brightness-110"
              >
                Open dashboard
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
