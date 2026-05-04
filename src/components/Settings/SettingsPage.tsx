import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check, X, Building2, Briefcase, Target, RefreshCw, Loader2, FileText, UploadCloud, Paperclip, AlertCircle,
  User, Sparkles, Send, ShieldAlert, LogOut, Mail, Trash2,
} from 'lucide-react'
import { STYLE_TESTS, scoreStyleChoices } from '../../lib/styleProfile'
import { generateStyleGuide, deleteAccount } from '../../lib/api'
import Banner from '../ui/Banner'
import ConfirmDialog from '../ui/ConfirmDialog'
import Toast from '../ui/Toast'
import { supabase, isDemo } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

// Maps the `google_error` codes returned by /api/google/callback into copy a
// student can act on. Anything not in the map gets a generic message.
const GOOGLE_ERROR_COPY: Record<string, string> = {
  callback_failed: 'Could not connect Gmail - Google rejected the sign-in. Try again, or remove access at myaccount.google.com first.',
  missing_code: 'Gmail connection failed - sign-in did not complete. Try again.',
  missing_refresh_token: 'Gmail connection failed - Google did not issue a refresh token. Remove access at myaccount.google.com and reconnect.',
  profile_save_failed: 'Could not save your Gmail token. Try again, or contact support if this keeps happening.',
  missing_google_config: 'Gmail integration is not configured on the server. Contact support.',
}

function googleErrorMessage(code: string | null): string {
  if (!code) return ''
  return GOOGLE_ERROR_COPY[code] ?? `Could not connect Gmail (${code}). Try again.`
}

const TABS = [
  { key: 'profile',      label: 'Profile',      icon: User },
  { key: 'style',        label: 'Style',        icon: Sparkles },
  { key: 'sending',      label: 'Sending',      icon: Send },
  { key: 'account',      label: 'Account',      icon: ShieldAlert },
] as const

type TabKey = typeof TABS[number]['key']

// Small generic helpers --------------------------------------------------------

function SaveBar({ dirty, saving, onSave, onDiscard, label = 'Save changes' }: {
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

function FieldGroup({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="surface-panel px-5 py-5 sm:px-6">
      <header className="mb-4">
        <h3 className="font-display text-base font-semibold text-dark">{title}</h3>
        {hint && <p className="mt-1 text-xs leading-5 text-muted">{hint}</p>}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

// Per-tab forms ---------------------------------------------------------------

function ProfileTab({ workspaceConfig, onSave }: { workspaceConfig: any; onSave: (u: any) => Promise<boolean> }) {
  const { user } = useAuth()
  const [form, setForm] = useState(workspaceConfig)
  const [saving, setSaving] = useState(false)
  const [uploadState, setUploadState] = useState({ uploading: false, error: null as string | null })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const initial = useMemo(() => JSON.stringify(pickProfileFields(workspaceConfig)), [workspaceConfig])
  const dirty = JSON.stringify(pickProfileFields(form)) !== initial

  useEffect(() => { setForm(workspaceConfig) }, [workspaceConfig])

  const field = (key: string, value: any) => setForm((c: any) => ({ ...c, [key]: value }))

  const uploadResume = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setUploadState({ uploading: false, error: 'File must be under 10 MB.' })
      return
    }
    setUploadState({ uploading: true, error: null })
    if (isDemo || !user?.id) {
      setForm((c: any) => ({ ...c, resumeFileName: file.name, resumePath: '', resumeUploadedAt: new Date().toISOString() }))
      setUploadState({ uploading: false, error: null })
      return
    }
    const path = `${user.id}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('resumes').upload(path, file, { upsert: true, contentType: file.type || undefined })
    if (error) { setUploadState({ uploading: false, error: error.message }); return }
    setForm((c: any) => ({ ...c, resumeFileName: file.name, resumePath: path, resumeUploadedAt: new Date().toISOString() }))
    setUploadState({ uploading: false, error: null })
  }

  const uploadedAt = form.resumeUploadedAt
    ? new Date(form.resumeUploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  const save = async () => {
    setSaving(true)
    const ok = await onSave((current: any) => ({ ...current, ...pickProfileFields(form) }))
    setSaving(false)
    return ok
  }

  return (
    <div className="space-y-5">
      <FieldGroup title="Sender identity" hint="Used in generated drafts.">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Sender name</label>
            <input value={form.senderName || ''} onChange={e => field('senderName', e.target.value)} placeholder="Jordan Lee" className="input" />
          </div>
          <div>
            <label className="label">Organization</label>
            <div className="relative">
              <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={form.senderCompany || ''} onChange={e => field('senderCompany', e.target.value)} placeholder="Cornell Generative AI" className="input pl-8" />
            </div>
          </div>
          <div>
            <label className="label">Role</label>
            <div className="relative">
              <Briefcase size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={form.senderRole || ''} onChange={e => field('senderRole', e.target.value)} placeholder="Founder" className="input pl-8" />
            </div>
          </div>
        </div>

      </FieldGroup>

      <FieldGroup title="Background" hint="Add context the draft should know.">
        <div>
          <label className="label">Pitch / experience</label>
          <textarea
            value={form.resumeText || ''}
            onChange={e => field('resumeText', e.target.value)}
            placeholder="Paste relevant experience, positioning, wins, and offer."
            className="input min-h-[140px] resize-y"
          />
          <p className="mt-1 text-xs text-muted">Bullets or prose both work.</p>
        </div>

        <div>
          <label className="label">Uploaded resume or bio</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            className="hidden"
            disabled={uploadState.uploading}
            onChange={e => uploadResume(e.target.files?.[0] || undefined)}
          />
          {form.resumeFileName ? (
            <div className="flex items-start justify-between gap-3 rounded-2xl border border-warm-200 bg-warm-50/60 px-3 py-2.5">
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
              className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-warm-300 bg-warm-50/40 px-3 py-2.5 text-sm text-muted transition-colors hover:border-primary/40 hover:text-dark disabled:opacity-50"
            >
              <UploadCloud size={14} />
              {uploadState.uploading ? 'Uploading…' : 'Upload resume or bio (.pdf, .doc, .txt - max 10 MB)'}
            </button>
          )}
          {uploadState.error && <p className="mt-1 text-xs text-red-500">Could not upload: {uploadState.error}</p>}
        </div>
      </FieldGroup>

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={save}
        onDiscard={() => setForm(workspaceConfig)}
        label="Save profile"
      />
    </div>
  )
}

function pickProfileFields(c: any) {
  return {
    senderName: c?.senderName || '',
    senderCompany: c?.senderCompany || '',
    senderRole: c?.senderRole || '',
    resumeText: c?.resumeText || '',
    resumeFileName: c?.resumeFileName || '',
    resumePath: c?.resumePath || '',
    resumeUploadedAt: c?.resumeUploadedAt || '',
  }
}

function StyleTab({ workspaceConfig, onSave }: { workspaceConfig: any; onSave: (u: any) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false)
  const [choices, setChoices] = useState<Record<string, string>>(workspaceConfig?.styleChoices || {})
  const [activeIndex, setActiveIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'scoring' | 'generating' | 'done'>('idle')
  const [promptDraft, setPromptDraft] = useState(workspaceConfig?.styleProfile?.prompt || '')
  const [savingPrompt, setSavingPrompt] = useState(false)

  useEffect(() => {
    setPromptDraft(workspaceConfig?.styleProfile?.prompt || '')
  }, [workspaceConfig?.styleProfile?.prompt])

  const styleGuide: string | null = workspaceConfig?.styleProfile?.prompt || null
  const currentTraits: string[] = workspaceConfig?.styleProfile?.traits || []
  const promptChanged = promptDraft.trim() !== (styleGuide || '').trim()

  const savePrompt = async () => {
    setSavingPrompt(true)
    await onSave((current: any) => ({
      ...current,
      styleProfile: { ...(current.styleProfile || {}), prompt: promptDraft.trim() },
    }))
    setSavingPrompt(false)
  }

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
    } catch { /* fall back to trait-based prompt */ }
    const ok = await onSave((current: any) => ({ ...current, styleProfile: finalProfile, styleChoices: choices }))
    setSaving(false)
    if (!ok) { setSaveStatus('idle'); return }
    setSaveStatus('done')
    setTimeout(() => setSaveStatus('idle'), 1500)
    setEditing(false)
  }

  const cancel = () => { setChoices(workspaceConfig?.styleChoices || {}); setActiveIndex(0); setEditing(false) }

  const savingLabel = saveStatus === 'generating'
    ? <><Loader2 size={13} className="animate-spin" /> Writing your style guide…</>
    : saveStatus === 'scoring'
      ? <><Loader2 size={13} className="animate-spin" /> Scoring…</>
      : saveStatus === 'done'
        ? <><Check size={13} /> Saved</>
        : <><Loader2 size={13} className="animate-spin" /> Saving</>

  return (
    <div className="space-y-5">
      <FieldGroup title="Writing style" hint="How drafts should sound.">
        {!editing ? (
          <>
            <div>
              <label className="label">Style instructions</label>
              <textarea
                value={promptDraft}
                onChange={e => setPromptDraft(e.target.value)}
                rows={5}
                className="input resize-y text-sm leading-relaxed"
                placeholder="e.g. Be direct and concise. State the reason for reaching out early. End with one clear, low-friction ask."
              />
            </div>
            {currentTraits.length > 0 && (
              <div>
                <label className="label">Detected traits</label>
                <div className="flex flex-wrap gap-1.5">
                  {currentTraits.map(trait => (
                    <span key={trait} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium capitalize text-primary">{trait}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setEditing(true)} className="btn-ghost text-xs">
                Retake quiz
              </button>
              {promptChanged && (
                <button type="button" onClick={savePrompt} disabled={savingPrompt} className="btn-primary text-xs">
                  {savingPrompt ? <><Loader2 size={13} className="animate-spin" /> Saving</> : <><Check size={13} /> Save instructions</>}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warm-200 pb-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                  {activeIndex + 1} of {STYLE_TESTS.length}
                </p>
                <h4 className="mt-1 text-base font-semibold text-dark">{activeTest.label}</h4>
                <p className="mt-0.5 text-sm text-muted">{activeTest.dimension}</p>
              </div>
              <div className="flex gap-1.5">
                {STYLE_TESTS.map((test, i) => (
                  <button
                    key={test.id}
                    type="button"
                    onClick={() => setActiveIndex(i)}
                    className={`h-2.5 rounded-full transition-all ${
                      i === activeIndex ? 'w-8 bg-primary' : choices[test.id] ? 'w-2.5 bg-primary/45' : 'w-2.5 bg-warm-300'
                    }`}
                    aria-label={`Question ${i + 1}`}
                  />
                ))}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {(['a', 'b'] as const).map(key => {
                const option = (activeTest as any)[key]
                const SAMPLE = { company: 'Momentum AI' }
                const fillSample = (text: string) => text.replace(/\{\{company\}\}/g, SAMPLE.company)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => choose(key)}
                    className={`flex flex-col rounded-2xl border px-4 py-3 text-left transition-all duration-150 ${
                      selected === key
                        ? 'border-primary bg-primary/5'
                        : 'border-warm-200 bg-warm-50/60 hover:-translate-y-0.5 hover:border-primary/40'
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
          </>
        )}
      </FieldGroup>
    </div>
  )
}

function SendingTab({ workspaceConfig, templates, onSave }: { workspaceConfig: any; templates: any[]; onSave: (u: any) => Promise<boolean> }) {
  const { user } = useAuth()
  const [form, setForm] = useState(workspaceConfig)
  const [saving, setSaving] = useState(false)
  const initial = useMemo(() => JSON.stringify(pickSendingFields(workspaceConfig)), [workspaceConfig])
  const dirty = JSON.stringify(pickSendingFields(form)) !== initial

  useEffect(() => { setForm(workspaceConfig) }, [workspaceConfig])

  const save = async () => {
    setSaving(true)
    const ok = await onSave((current: any) => ({
      ...current,
      ...pickSendingFields(form),
      sendingLimits: { ...current.sendingLimits, ...form.sendingLimits },
    }))
    setSaving(false)
    return ok
  }

  const limits = form.sendingLimits || { dailyMax: 100, delaySeconds: 15 }
  const setLimit = (k: string, v: number) => setForm((c: any) => ({ ...c, sendingLimits: { ...(c.sendingLimits || {}), [k]: v } }))

  return (
    <div className="space-y-5">
      <FieldGroup title="Send rate" hint="Limits for outbound email.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Daily send limit</label>
            <input
              type="number" min={1} max={100} value={limits.dailyMax}
              onChange={e => setLimit('dailyMax', Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
              className="input"
            />
            <p className="mt-1 text-xs text-muted">Hard cap: 100 per day.</p>
          </div>
          <div>
            <label className="label">Delay between sends</label>
            <div className="relative">
              <input
                type="number" min={15} max={3600} value={limits.delaySeconds}
                onChange={e => setLimit('delaySeconds', Math.max(15, parseInt(e.target.value) || 15))}
                className="input pr-16"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">seconds</span>
            </div>
            <p className="mt-1 text-xs text-muted">Minimum 15 seconds between sends.</p>
          </div>
        </div>
      </FieldGroup>

      <FieldGroup title="Defaults for new campaigns" hint="Pre-filled when you create a campaign.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Lead batch size</label>
            <div className="relative">
              <Target size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="number" min={1} max={50}
                value={form.leadsPerGeneration || 25}
                onChange={e => setForm((c: any) => ({ ...c, leadsPerGeneration: Math.min(50, Math.max(1, Number(e.target.value) || 1)) }))}
                className="input pl-8"
              />
            </div>
            <p className="mt-1 text-xs text-muted">Contacts per batch.</p>
          </div>
          <div>
            <label className="label">Default template</label>
            <select
              value={form.templateId || ''}
              onChange={e => setForm((c: any) => ({ ...c, templateId: e.target.value }))}
              className="select"
            >
              <option value="">No default</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">Used by default.</p>
          </div>
        </div>

      </FieldGroup>

      <FieldGroup title="Attachment library" hint="Reusable files for drafts.">
        <FileLibrary form={form} setForm={setForm} user={user} />
      </FieldGroup>

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={save}
        onDiscard={() => setForm(workspaceConfig)}
        label="Save sending settings"
      />
    </div>
  )
}

function pickSendingFields(c: any) {
  return {
    leadsPerGeneration: c?.leadsPerGeneration ?? 25,
    templateId: c?.templateId ?? '',
    sendingLimits: c?.sendingLimits || { dailyMax: 100, delaySeconds: 15 },
    files: c?.files || [],
  }
}

type WorkspaceFile = { id: string; path: string; fileName: string; mimeType: string; size: number; uploadedAt: string }

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileLibrary({ form, setForm, user }: { form: any; setForm: (fn: (c: any) => any) => void; user: any }) {
  const files: WorkspaceFile[] = form.files || []
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const uploadFile = async (file: File) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { setUploadError('File must be under 10 MB.'); return }
    setUploading(true); setUploadError(null)
    const fileId = crypto.randomUUID()
    const path = `files/${user?.id ?? 'demo'}/${fileId}`
    if (!isDemo && user?.id) {
      const { error } = await supabase.storage.from('resumes').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
      if (error) { setUploadError(error.message); setUploading(false); return }
    }
    const newFile: WorkspaceFile = {
      id: fileId, path, fileName: file.name,
      mimeType: file.type || 'application/octet-stream', size: file.size,
      uploadedAt: new Date().toISOString(),
    }
    setForm((c: any) => ({ ...c, files: [...(c.files || []), newFile] }))
    setUploading(false)
  }

  const removeFile = async (fileId: string) => {
    const meta = files.find(f => f.id === fileId)
    if (meta && !isDemo && user?.id) await supabase.storage.from('resumes').remove([meta.path])
    setForm((c: any) => ({ ...c, files: (c.files || []).filter((f: WorkspaceFile) => f.id !== fileId) }))
  }

  return (
    <div>
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
          className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-warm-300 bg-warm-50/40 px-3 py-2.5 text-sm text-muted transition-colors hover:border-primary/40 hover:text-dark disabled:opacity-50"
        >
          <Paperclip size={14} />
          {uploading ? 'Uploading…' : 'Upload files to attach to emails (PDF, DOCX, TXT - max 10 MB)'}
        </button>
      ) : (
        <div className="space-y-1.5">
          {files.map(f => (
            <div key={f.id} className="flex items-center gap-2 rounded-2xl border border-warm-200 bg-warm-50/60 px-3 py-2">
              <FileText size={13} className="shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-dark">{f.fileName}</p>
                <p className="text-xs text-muted">{formatBytes(f.size)} · {new Date(f.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              </div>
              <button
                type="button"
                onClick={() => removeFile(f.id)}
                className="shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-warm-100 hover:text-dark"
                title="Remove file"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn-ghost mt-2 text-xs"
          >
            <Paperclip size={12} /> {uploading ? 'Uploading…' : 'Add another file'}
          </button>
        </div>
      )}
    </div>
  )
}

function AccountTab({
  profile, profileLoading, onRefreshProfile, onConnectGoogle,
}: {
  profile: any
  profileLoading: boolean
  onRefreshProfile: () => void
  onConnectGoogle: (() => void) | null
}) {
  const { user, signOut } = useAuth()
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const hasGoogle = !!profile?.hasGoogleRefreshToken

  const handleDelete = async () => {
    setLoading(true); setError('')
    const deletion = deleteAccount()
    await signOut()
    deletion.catch(err => {
      console.error('Account deletion failed after sign-out', err)
    })
  }

  return (
    <div className="space-y-5">
      <FieldGroup title="Account">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-dark">{user?.email || 'Demo user'}</p>
            <p className="mt-0.5 text-xs text-muted">{user?.user_metadata?.full_name || 'No display name set'}</p>
          </div>
          <button type="button" onClick={signOut} className="btn-secondary text-xs">
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </FieldGroup>

      <FieldGroup title="Gmail">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-warm-200 bg-warm-50/60 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${hasGoogle ? 'bg-emerald-50 text-emerald-600' : 'bg-warm-100 text-muted'}`}>
              <Mail size={16} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-dark">{hasGoogle ? 'Connected' : 'Not connected'}</p>
              <p className="mt-0.5 text-xs text-muted">
                {hasGoogle ? 'Ready to send drafts.' : 'Connect before sending.'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onRefreshProfile}
              disabled={profileLoading}
              className="btn-ghost text-xs"
              title="Refresh Gmail status"
            >
              <RefreshCw size={12} className={profileLoading ? 'animate-spin' : ''} /> Refresh
            </button>
            {!hasGoogle && onConnectGoogle && (
              <button type="button" onClick={onConnectGoogle} className="btn-primary text-xs">
                Connect
              </button>
            )}
          </div>
        </div>
      </FieldGroup>

      <FieldGroup title="Danger zone">
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-red-200 bg-red-50/50 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-dark">Delete account</p>
            <p className="mt-0.5 text-xs text-muted">
              Permanently delete your account and workspace data.
            </p>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </div>
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-warm-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
          >
            <Trash2 size={12} /> Delete account
          </button>
        </div>
      </FieldGroup>

      <ConfirmDialog
        open={confirm}
        title="Delete account"
        message="This permanently deletes your account, campaigns, leads, and emails."
        confirmLabel={loading ? 'Deleting…' : 'Yes, delete my account'}
        onConfirm={handleDelete}
        onClose={() => setConfirm(false)}
      />
    </div>
  )
}

// Tab nav --------------------------------------------------------------------

function TabBar({ active, onChange, status }: {
  active: TabKey
  onChange: (t: TabKey) => void
  status: Record<TabKey, 'ok' | 'warn' | null>
}) {
  return (
    <nav role="tablist" aria-label="Settings sections" className="sticky top-0 z-10 flex flex-wrap gap-1 overflow-x-clip border-b border-warm-200 bg-surface/95 pt-1 backdrop-blur">
      {TABS.map(t => {
        const isActive = active === t.key
        const Icon = t.icon
        const dot = status[t.key]
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={`relative inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'text-dark after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
                : 'text-muted hover:text-dark'
            }`}
          >
            <Icon size={14} />
            {t.label}
            {dot === 'warn' && (
              <span aria-hidden className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" title="Setup incomplete" />
            )}
          </button>
        )
      })}
    </nav>
  )
}

// Page -----------------------------------------------------------------------

export default function SettingsPage({
  workspaceConfig, onSaveWorkspaceConfig, templates,
  profile, profileLoading, onRefreshProfile, onConnectGoogle,
}: any) {
  const [toast, setToast] = useState<any>(null)
  const [oauthResult, setOauthResult] = useState<{ kind: 'success' } | { kind: 'error'; message: string } | null>(null)
  const [active, setActive] = useState<TabKey>('profile')

  // The Gmail OAuth callback at /api/google/callback redirects back here with
  // either ?google_connected=1 (success) or ?google_error=<code> (failure).
  // Read the params, surface a banner, then strip them from the URL so a
  // refresh does not re-fire the banner.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('google_error')
    const success = params.get('google_connected')
    if (!error && !success) return
    setOauthResult(error ? { kind: 'error', message: googleErrorMessage(error) } : { kind: 'success' })
    if (error || success) setActive('account')
    params.delete('google_error')
    params.delete('google_connected')
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
    window.history.replaceState(null, '', next)
  }, [])

  const saveWorkspace = async (updater: any, label = 'Settings saved') => {
    try {
      await onSaveWorkspaceConfig(updater)
      setToast({ type: 'success', title: label })
      return true
    } catch (err: any) {
      setToast({ type: 'error', title: 'Settings could not be saved', message: err?.message || 'Try again.' })
      return false
    }
  }

  const hasGoogle = !!profile?.hasGoogleRefreshToken
  const hasResume = !!workspaceConfig?.resumeText?.trim() || !!workspaceConfig?.resumeFileName || !!profile?.resumeText
  const hasSender = !!workspaceConfig?.senderName?.trim()

  // Wrap onConnectGoogle so any synchronous error returned by the auth
  // context (demo-mode rejection, network failure before redirect) is
  // surfaced as a banner instead of disappearing silently.
  const handleConnect = onConnectGoogle ? async () => {
    const res = await onConnectGoogle()
    if (res?.error?.message) setOauthResult({ kind: 'error', message: res.error.message })
  } : null

  const tabStatus: Record<TabKey, 'ok' | 'warn' | null> = {
    profile:      hasSender && hasResume ? 'ok' : 'warn',
    style:        null,
    sending:      null,
    account:      hasGoogle ? 'ok' : 'warn',
  }

  return (
    <div className="page-shell max-w-5xl">
      <Toast toast={toast} onClose={() => setToast(null)} />

      <header className="flex flex-col gap-1">
        <p className="page-eyebrow">Settings</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-dark">Workspace settings</h1>
        <p className="text-sm text-muted">Profile, writing style, sending, and account.</p>
      </header>

      {oauthResult?.kind === 'success' && (
        <Banner variant="success" icon={Check}>Gmail connected. You can now send emails from Drafts.</Banner>
      )}
      {oauthResult?.kind === 'error' && (
        <Banner variant="danger" icon={AlertCircle}>{oauthResult.message}</Banner>
      )}

      <TabBar active={active} onChange={setActive} status={tabStatus} />

      <div className="pt-1">
        {active === 'profile' && (
          <ProfileTab
            workspaceConfig={workspaceConfig}
            onSave={(updater) => saveWorkspace(updater, 'Profile saved')}
          />
        )}
        {active === 'style' && (
          <StyleTab
            workspaceConfig={workspaceConfig}
            onSave={(updater) => saveWorkspace(updater, 'Style saved')}
          />
        )}
        {active === 'sending' && (
          <SendingTab
            workspaceConfig={workspaceConfig}
            templates={templates}
            onSave={(updater) => saveWorkspace(updater, 'Sending settings saved')}
          />
        )}
        {active === 'account' && (
          <AccountTab
            profile={profile}
            profileLoading={profileLoading}
            onRefreshProfile={onRefreshProfile}
            onConnectGoogle={handleConnect}
          />
        )}
      </div>
    </div>
  )
}
