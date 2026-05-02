import React, { useEffect, useRef, useState } from 'react'
import {
  Plus, Check, X,
  Building2, Briefcase, Target, CheckCircle2, Circle, RefreshCw, Loader2, FileText, UploadCloud, Paperclip,
} from 'lucide-react'
import { STYLE_TESTS, scoreStyleChoices } from '../../lib/styleProfile'
import { generateStyleGuide } from '../../lib/api'
import Banner from '../ui/Banner'
import ConfirmDialog from '../ui/ConfirmDialog'
import Toast from '../ui/Toast'
import { supabase, isDemo } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

function Section({ title, children }) {
  return (
    <div className="space-y-4 py-4">
      <div className="pb-3 border-b border-neutral-200">
        <h2 className="text-sm font-semibold text-dark">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function SetupReadinessPanel({ workspaceConfig, templates, profile, profileLoading, onRefreshProfile, onGoToOnboarding, onConnectGoogle, onNavigate }) {
  const hasClaude = !!workspaceConfig?.apiKeys?.claude || !!profile?.hasClaudeKey
  const hasGoogle = !!profile?.hasGoogleRefreshToken
  const hasResume = !!workspaceConfig?.resumeText?.trim() || !!workspaceConfig?.resumeFileName || !!profile?.resumeText
  const hasSender = !!workspaceConfig?.senderName?.trim()
  const hasTemplate = !!workspaceConfig?.templateId || templates.length > 0

  const items = [
    {
      label: 'Google connected',
      detail: hasGoogle ? 'Connected.' : 'Connect Google to enable Gmail sending.',
      done: hasGoogle,
      action: onConnectGoogle ? { label: 'Reconnect', onClick: onConnectGoogle } : null,
    },
    {
      label: 'Claude key added',
      detail: hasClaude ? 'Ready.' : 'Add a Claude key to generate drafts.',
      done: hasClaude,
    },
    {
      label: 'Background added',
      detail: hasResume ? 'Added.' : 'Add a resume or bio.',
      done: hasResume,
    },
    {
      label: 'Sender set',
      detail: hasSender ? `Drafting as ${workspaceConfig.senderName}.` : 'Set your sender name.',
      done: hasSender,
    },
    {
      label: 'Template selected',
      detail: hasTemplate ? 'Template set.' : 'Create or select a template.',
      done: hasTemplate,
      action: onNavigate ? { label: 'Templates', onClick: () => onNavigate('templates') } : null,
    },
  ]

  const completeCount = items.filter(item => item.done).length
  const ready = completeCount === items.length

  return (
    <div className="border-b border-neutral-200 pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="page-eyebrow">Setup readiness</p>
          <h2 className="mt-1 text-lg font-semibold text-dark">
            {ready ? 'Ready' : `${completeCount} of ${items.length} complete`}
          </h2>
        </div>
        <button
          type="button"
          onClick={onRefreshProfile}
          disabled={profileLoading}
          className="btn-ghost px-2 py-1 text-xs"
          title="Refresh setup status"
        >
          <RefreshCw size={13} className={profileLoading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="mt-4 divide-y divide-neutral-200">
        {items.map(item => {
          const Icon = item.done ? CheckCircle2 : Circle
          return (
            <div key={item.label} className="flex items-start gap-3 py-3">
              <Icon size={15} className={`mt-0.5 shrink-0 ${item.done ? 'text-emerald-600' : 'text-stone-300'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-dark">{item.label}</p>
                <p className="mt-0.5 text-xs leading-5 text-muted">{item.detail}</p>
              </div>
              {item.action && !item.done && (
                <button type="button" onClick={item.action.onClick} className="shrink-0 text-xs font-semibold text-primary hover:underline">
                  {item.action.label}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type WorkspaceFile = { id: string; path: string; fileName: string; mimeType: string; size: number; uploadedAt: string }

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileLibrarySection({ form, field, user }) {
  const files: WorkspaceFile[] = form.files || []
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const uploadFile = async (file: File) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File must be under 10 MB.')
      return
    }
    setUploading(true)
    setUploadError(null)
    const fileId = crypto.randomUUID()
    const path = `files/${user?.id ?? 'demo'}/${fileId}`
    if (!isDemo && user?.id) {
      const { error } = await supabase.storage
        .from('resumes')
        .upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
      if (error) {
        setUploadError(error.message)
        setUploading(false)
        return
      }
    }
    const newFile: WorkspaceFile = {
      id: fileId,
      path,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      uploadedAt: new Date().toISOString(),
    }
    field('files', [...files, newFile])
    setUploading(false)
  }

  const removeFile = async (fileId: string) => {
    const meta = files.find(f => f.id === fileId)
    if (meta && !isDemo && user?.id) {
      await supabase.storage.from('resumes').remove([meta.path])
    }
    field('files', files.filter(f => f.id !== fileId))
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="label mb-0">Attachment library</label>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="btn-ghost px-2 py-1 text-xs"
        >
          <Paperclip size={12} /> {uploading ? 'Uploading…' : 'Add file'}
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        disabled={uploading}
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }}
      />
      {uploadError && <p className="mb-2 text-xs text-red-500">{uploadError}</p>}
      {files.length === 0 ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-neutral-300 bg-surface px-3 py-2.5 text-sm text-muted transition-colors hover:border-primary/40 hover:text-dark disabled:opacity-50"
        >
          <Paperclip size={14} />
          {uploading ? 'Uploading…' : 'Upload files to attach to emails (PDF, DOCX, TXT — max 10 MB)'}
        </button>
      ) : (
        <div className="space-y-1.5">
          {files.map(f => (
            <div key={f.id} className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-surface px-3 py-2">
              <FileText size={13} className="shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-dark">{f.fileName}</p>
                <p className="text-xs text-muted">{formatBytes(f.size)} · {new Date(f.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              </div>
              <button
                type="button"
                onClick={() => removeFile(f.id)}
                className="shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-neutral-100 hover:text-dark"
                title="Remove file"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-muted">Files saved here can be attached to individual drafts or set as defaults on a campaign.</p>
    </div>
  )
}

function WorkspaceProfileSection({ workspaceConfig, onSave, templates }) {
  const { user } = useAuth()
  const [form, setForm] = useState(workspaceConfig)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploadState, setUploadState] = useState({ uploading: false, error: null })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const field = (key, value) => setForm(current => ({ ...current, [key]: value }))

  useEffect(() => {
    setForm(workspaceConfig)
  }, [workspaceConfig])

  const save = async () => {
    setSaving(true)
    const ok = await onSave(current => ({ ...current, ...form }))
    setSaving(false)
    if (!ok) return
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const uploadResume = async (file) => {
    if (!file) return
    setUploadState({ uploading: true, error: null })
    if (file.size > 10 * 1024 * 1024) {
      setUploadState({ uploading: false, error: 'File must be under 10 MB.' })
      return
    }

    if (isDemo || !user?.id) {
      setForm(current => ({ ...current, resumeFileName: file.name, resumePath: '', resumeUploadedAt: new Date().toISOString() }))
      setUploadState({ uploading: false, error: null })
      return
    }

    const path = `${user.id}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage
      .from('resumes')
      .upload(path, file, { upsert: true, contentType: file.type || undefined })

    if (error) {
      setUploadState({ uploading: false, error: error.message })
      return
    }

    setForm(current => ({ ...current, resumeFileName: file.name, resumePath: path, resumeUploadedAt: new Date().toISOString() }))
    setUploadState({ uploading: false, error: null })
  }

  const uploadedAt = form.resumeUploadedAt
    ? new Date(form.resumeUploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <Section title="Drafting Profile">
      <div>
        <label className="label">Background</label>
        <textarea
          value={form.resumeText}
          onChange={e => field('resumeText', e.target.value)}
          placeholder="Paste relevant experience, positioning, wins, and offer."
          className="input min-h-[140px] resize-y"
        />
        <p className="mt-1 text-xs text-muted">Used in email generation to personalize your pitch.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Uploaded resume or bio</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            className="hidden"
            disabled={uploadState.uploading}
            onChange={e => uploadResume(e.target.files?.[0])}
          />
          {form.resumeFileName ? (
            <div className="flex items-start justify-between gap-3 rounded-2xl border border-neutral-300 bg-surface px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <FileText size={14} className="shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-dark">{form.resumeFileName}</p>
                  {uploadedAt && <p className="text-xs text-muted">Uploaded {uploadedAt}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadState.uploading}
                className="shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-50"
              >
                {uploadState.uploading ? 'Uploading…' : 'Replace'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadState.uploading}
              className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-neutral-300 bg-surface px-3 py-2.5 text-sm text-muted transition-colors hover:border-primary/40 hover:text-dark disabled:opacity-50"
            >
              <UploadCloud size={14} />
              {uploadState.uploading ? 'Uploading…' : 'Upload resume or bio (.pdf, .doc, .txt)'}
            </button>
          )}
          {uploadState.error && (
            <p className="mt-1 text-xs text-red-500">Could not upload: {uploadState.error}</p>
          )}
        </div>
        <div>
          <label className="label">Default lead batch size</label>
          <div className="relative">
            <Target size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="number"
              min={1}
              max={50}
              value={form.leadsPerGeneration}
              onChange={e => field('leadsPerGeneration', Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
              className="input pl-8"
            />
          </div>
          <p className="mt-1 text-xs text-muted">Contacts fetched per campaign batch run.</p>
        </div>
      </div>

      {/* File library */}
      <FileLibrarySection form={form} field={field} user={user} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Sender name</label>
          <input value={form.senderName} onChange={e => field('senderName', e.target.value)} placeholder="Jordan Lee" className="input" />
        </div>
        <div>
          <label className="label">Organization</label>
          <div className="relative">
            <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={form.senderCompany} onChange={e => field('senderCompany', e.target.value)} placeholder="Cornell Generative AI" className="input pl-8" />
          </div>
        </div>
        <div>
          <label className="label">Role</label>
          <div className="relative">
            <Briefcase size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={form.senderRole} onChange={e => field('senderRole', e.target.value)} placeholder="Founder" className="input pl-8" />
          </div>
        </div>
      </div>
      <p className="mt-0.5 text-xs text-muted">Sender name, organization, and role are included in every generated email.</p>

      <div>
        <label className="label">Default template</label>
        <select value={form.templateId} onChange={e => field('templateId', e.target.value)} className="select">
          {templates.map(template => (
            <option key={template.id} value={template.id}>{template.name}</option>
          ))}
        </select>
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving || uploadState.uploading} className="btn-primary">
          {saving ? <><Loader2 size={14} className="animate-spin" /> Saving</> : saved ? <><Check size={14} /> Saved</> : 'Save drafting profile'}
        </button>
      </div>
    </Section>
  )
}

function ProviderKeysSection({ workspaceConfig, profile, onRefreshProfile, onSave }) {
  const [form, setForm] = useState({ claude: workspaceConfig.apiKeys?.claude || '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setForm({ claude: workspaceConfig.apiKeys?.claude || '' })
  }, [workspaceConfig])

  const save = async () => {
    setSaving(true)
    const ok = await onSave(current => ({
      ...current,
      apiKeys: { ...current.apiKeys, ...form },
    }))
    setSaving(false)
    if (!ok) return
    if (form.claude) onRefreshProfile?.()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const hasSavedClaude = !!profile?.hasClaudeKey

  return (
    <Section title="Provider Keys">
      <p className="text-xs text-muted">
        {hasSavedClaude ? 'Claude key saved.' : 'No Claude key yet.'} Saved keys are hidden — enter a new value to replace.
      </p>

      <div>
        <label className="label">Claude</label>
        <input
          type="password"
          value={form.claude}
          onChange={e => setForm(current => ({ ...current, claude: e.target.value }))}
          placeholder={hasSavedClaude ? 'Saved key on file' : 'Anthropic API key'}
          className="input"
        />
        {hasSavedClaude && !form.claude && (
          <p className="mt-1 text-xs text-emerald-700">Saved. Leave blank to keep it.</p>
        )}
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <><Loader2 size={14} className="animate-spin" /> Saving</> : saved ? <><Check size={14} /> Saved</> : 'Save provider keys'}
        </button>
      </div>
    </Section>
  )
}


function SendingLimitsSection({ workspaceConfig, onSave }) {
  const [form, setForm] = useState(workspaceConfig.sendingLimits || { dailyMax: 100, delaySeconds: 15 })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const f = (k, v) => setForm(x => ({ ...x, [k]: v }))

  useEffect(() => {
    setForm(workspaceConfig.sendingLimits || { dailyMax: 100, delaySeconds: 15 })
  }, [workspaceConfig])

  const save = async () => {
    setSaving(true)
    const ok = await onSave(current => ({
      ...current,
      sendingLimits: {
        ...current.sendingLimits,
        ...form,
      },
    }))
    setSaving(false)
    if (!ok) return
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Section title="Sending Limits">
      <Banner variant="warning" size="sm">
        These limits are saved but not yet enforced server-side — emails send immediately regardless of these values. Enforcement is planned.
      </Banner>
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
        <div>
          <label className="label">Daily send limit</label>
          <input type="number" min={1} max={100} value={form.dailyMax} onChange={e => f('dailyMax', Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))} className="input" />
          <p className="text-xs text-muted mt-1">Maximum emails per day across all campaigns (cap: 100).</p>
        </div>
        <div>
          <label className="label">Delay between sends (seconds)</label>
          <input type="number" min={15} max={3600} value={form.delaySeconds} onChange={e => f('delaySeconds', Math.max(15, parseInt(e.target.value) || 15))} className="input" />
          <p className="text-xs text-muted mt-1">Minimum 15 seconds between sends to avoid Gmail throttling.</p>
        </div>
      </div>
      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <><Loader2 size={14} className="animate-spin" /> Saving</> : saved ? <><Check size={14} /> Saved</> : 'Save limits'}
        </button>
      </div>
    </Section>
  )
}

const SAMPLE = { company: 'Momentum AI' }
function fillSample(text) {
  return text.replace(/\{\{company\}\}/g, SAMPLE.company)
}

function StyleSection({ workspaceConfig, onSave }) {
  const [editing, setEditing] = useState(false)
  const [choices, setChoices] = useState<Record<string, string>>(workspaceConfig?.styleChoices || {})
  const [activeIndex, setActiveIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'scoring' | 'generating' | 'done'>('idle')

  const styleGuide: string | null = workspaceConfig?.styleProfile?.prompt || null
  const currentTraits: string[] = workspaceConfig?.styleProfile?.traits || []
  const hasStyle = styleGuide || currentTraits.length > 0

  const activeTest = STYLE_TESTS[activeIndex]
  const selected = choices[activeTest.id]

  const choose = (key: string) => {
    const next = { ...choices, [activeTest.id]: key }
    setChoices(next)
    const nextUnanswered = STYLE_TESTS.findIndex((t, i) => i > activeIndex && !next[t.id])
    if (nextUnanswered >= 0) setActiveIndex(nextUnanswered)
  }

  const save = async () => {
    setSaving(true)
    setSaveStatus('scoring')
    const baseProfile = scoreStyleChoices(choices)

    setSaveStatus('generating')
    let finalProfile = baseProfile
    try {
      const { guide } = await generateStyleGuide(baseProfile.examples ?? [])
      finalProfile = { ...baseProfile, prompt: guide }
    } catch {
      // Fall back to trait-based prompt if Claude call fails
    }

    const ok = await onSave((current) => ({ ...current, styleProfile: finalProfile, styleChoices: choices }))
    setSaving(false)
    if (!ok) {
      setSaveStatus('idle')
      return
    }
    setSaveStatus('done')
    setTimeout(() => setSaveStatus('idle'), 1500)
    setEditing(false)
  }

  const cancel = () => {
    setChoices(workspaceConfig?.styleChoices || {})
    setActiveIndex(0)
    setEditing(false)
  }

  const savingLabel = saveStatus === 'generating'
    ? <><Loader2 size={13} className="animate-spin" /> Writing your style guide…</>
    : saveStatus === 'scoring'
      ? <><Loader2 size={13} className="animate-spin" /> Scoring…</>
      : saveStatus === 'done'
        ? <><Check size={13} /> Saved</>
        : <><Loader2 size={13} className="animate-spin" /> Saving</>

  return (
    <Section title="Email Style">
      {!editing ? (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {hasStyle ? (
              <>
                {styleGuide && (
                  <p className="text-sm leading-6 text-dark">{styleGuide}</p>
                )}
                {currentTraits.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {currentTraits.map(trait => (
                      <span key={trait} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary capitalize">{trait}</span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted">No style configured. Take the quiz to set your drafting voice.</p>
            )}
          </div>
          <button type="button" onClick={() => setEditing(true)} className="btn-secondary shrink-0 text-xs">
            {hasStyle ? 'Reconfigure' : 'Take quiz'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                {activeIndex + 1} of {STYLE_TESTS.length}
              </p>
              <h3 className="mt-1 text-base font-semibold text-dark">{activeTest.label}</h3>
              <p className="mt-0.5 text-sm text-muted">{activeTest.dimension}</p>
            </div>
            <div className="flex gap-1.5">
              {STYLE_TESTS.map((test, i) => (
                <button
                  key={test.id}
                  type="button"
                  onClick={() => setActiveIndex(i)}
                  className={`h-2.5 rounded-full transition-all ${
                    i === activeIndex ? 'w-8 bg-primary' : choices[test.id] ? 'w-2.5 bg-primary/45' : 'w-2.5 bg-stone-300'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {(['a', 'b'] as const).map(key => {
              const option = activeTest[key]
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => choose(key)}
                  className={`flex flex-col rounded-2xl border px-4 py-3 text-left transition-all ${
                    selected === key
                      ? 'border-primary bg-primary/5 shadow-[0_8px_24px_rgba(245,203,92,0.10)]'
                      : 'border-neutral-300 bg-neutral-50 hover:border-primary/40'
                  }`}
                >
                  <p className="mb-2 text-sm font-semibold text-dark">{option.label}</p>
                  <p className="whitespace-pre-line text-xs leading-5 text-muted">{fillSample(option.body)}</p>
                </button>
              )
            })}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={cancel} disabled={saving} className="btn-ghost text-xs">Cancel</button>
            <button
              type="button"
              onClick={save}
              disabled={saving || Object.keys(choices).length < STYLE_TESTS.length}
              className="btn-primary text-xs"
            >
              {saving ? savingLabel : <><Check size={13} /> Save style</>}
            </button>
          </div>
        </div>
      )}
    </Section>
  )
}

export default function SettingsPage({ workspaceConfig, onSaveWorkspaceConfig, templates, profile, profileLoading, onRefreshProfile, onGoToOnboarding, onConnectGoogle, onNavigate }) {
  const [toast, setToast] = useState(null)
  const saveWorkspace = async (updater, label = 'Settings saved') => {
    try {
      await onSaveWorkspaceConfig(updater)
      setToast({ type: 'success', title: label })
      return true
    } catch (err) {
      setToast({
        type: 'error',
        title: 'Settings could not be saved',
        message: err.message || 'Try again.',
      })
      return false
    }
  }

  return (
    <div className="w-full max-w-3xl space-y-6 px-4 pb-10 pt-5 sm:px-6 lg:px-8">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold text-dark">Settings</h1>
      </div>
      <SetupReadinessPanel
        workspaceConfig={workspaceConfig}
        templates={templates}
        profile={profile}
        profileLoading={profileLoading}
        onRefreshProfile={onRefreshProfile}
        onGoToOnboarding={onGoToOnboarding}
        onConnectGoogle={onConnectGoogle}
        onNavigate={onNavigate}
      />
      <WorkspaceProfileSection
        workspaceConfig={workspaceConfig}
        onSave={(updater) => saveWorkspace(updater, 'Workspace profile saved')}
        templates={templates}
      />
      <StyleSection
        workspaceConfig={workspaceConfig}
        onSave={(updater) => saveWorkspace(updater, 'Style saved')}
      />
      <ProviderKeysSection
        workspaceConfig={workspaceConfig}
        profile={profile}
        onRefreshProfile={onRefreshProfile}
        onSave={(updater) => saveWorkspace(updater, 'Provider keys saved')}
      />
      <SendingLimitsSection
        workspaceConfig={workspaceConfig}
        onSave={(updater) => saveWorkspace(updater, 'Sending limits saved')}
      />
    </div>
  )
}
