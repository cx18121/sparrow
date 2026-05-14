import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check, X, Target, RefreshCw, Loader2, FileText, UploadCloud, Paperclip, AlertCircle,
  LogOut, Mail, Trash2, MessageSquare, Send as SendIcon,
} from 'lucide-react'
import { deleteAccount } from '../../lib/api'
import Banner from '../ui/Banner'
import ConfirmDialog from '../ui/ConfirmDialog'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { canExtractResumeText, extractResumeTextFromFile } from '../../lib/resumeText'
import { LEAD_BATCH_MAX, LEAD_BATCH_MIN } from '../../lib/workspaceConfig'
import { SETTINGS_TABS, getGoogleErrorMessage, getSettingsTabStatus, type SettingsTabKey } from '../../lib/profileSetup'

const TABS = SETTINGS_TABS
type TabKey = SettingsTabKey

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

function CapabilityRow({ icon: Icon, label, enabled, disabledHint }: {
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

function FieldGroup({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
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

// Number input that clamps on blur, not on every keystroke — so users can
// clear and retype without the value snapping back to min mid-edit. When the
// typed value lands outside [min, max] on blur, `onClamp` fires with the raw
// typed value and the clamped result so the parent can surface a toast or
// inline message (otherwise the silent clamp confuses users who think their
// number was accepted).
type ClampedNumberInputProps = {
  value: number
  onChange: (next: number) => void
  min: number
  max: number
  onClamp?: (info: { raw: number; clamped: number }) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'type'>

function ClampedNumberInput({ value, onChange, min, max, onClamp, ...rest }: ClampedNumberInputProps) {
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
        // instead of silently snapping to min. An accidental clear used to
        // wipe the user's setting to `min` with no feedback — preserving
        // the prior value matches what most form libraries do.
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
    if (!canExtractResumeText(file)) {
      setUploadState({ uploading: false, error: 'Use a PDF, DOCX, or TXT file.' })
      return
    }
    setUploadState({ uploading: true, error: null })
    let extractedResumeText = ''
    try {
      extractedResumeText = await extractResumeTextFromFile(file)
    } catch (err: any) {
      setUploadState({ uploading: false, error: err?.message || 'Could not read that file.' })
      return
    }
    if (!user?.id) {
      const nextForm = { ...form, resumeFileName: file.name, resumePath: '', resumeUploadedAt: new Date().toISOString(), resumeExtractedText: extractedResumeText || form.resumeExtractedText || '' }
      setForm(nextForm)
      setUploadState({ uploading: false, error: null })
      return
    }
    const path = `${user.id}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('resumes').upload(path, file, { upsert: true, contentType: file.type || undefined })
    if (error) { setUploadState({ uploading: false, error: error.message }); return }
    const nextForm = {
      ...form,
      resumeFileName: file.name,
      resumePath: path,
      resumeUploadedAt: new Date().toISOString(),
      resumeExtractedText: extractedResumeText || form.resumeExtractedText || '',
    }
    const saved = await onSave((current: any) => ({ ...current, ...pickProfileFields(nextForm) }))
    if (!saved) setForm(nextForm)
    setUploadState({ uploading: false, error: saved ? null : 'Uploaded, but profile save failed. Click Save to retry.' })
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
      <p className="text-xs text-muted leading-5">
        These are the same fields you filled in during onboarding. Changes here are reflected in all future AI-generated drafts.
      </p>
      <FieldGroup title="Sender identity" hint="Used in generated drafts.">
        <div>
          <label htmlFor="settings-sender-name" className="label">
            Sender name
            {!form.senderName?.trim() && <span className="ml-1 form-warning-text font-semibold">Required</span>}
          </label>
          <input
            id="settings-sender-name"
            value={form.senderName || ''}
            onChange={e => field('senderName', e.target.value)}
            placeholder="Jordan Lee"
            className={`input ${!form.senderName?.trim() ? 'input-warning' : ''}`}
          />
        </div>
      </FieldGroup>

      <FieldGroup title="Background" hint={!form.resumeText?.trim() && !form.resumeFileName ? "⚠ Add your background so drafts can personalize around your experience." : "Add context the draft should know."}>
        <div>
          <label htmlFor="settings-resume-text" className="label">Pitch / experience</label>
          <textarea
            id="settings-resume-text"
            value={form.resumeText || ''}
            onChange={e => field('resumeText', e.target.value)}
            placeholder="Paste relevant experience, positioning, wins, and offer."
            className="input min-h-[140px] resize-y"
          />
          <p className="mt-1 text-xs text-muted">Bullets or prose both work.</p>
        </div>

        <div>
          <label htmlFor="settings-resume-file" className="label">Uploaded resume or bio</label>
          <input
            id="settings-resume-file"
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt"
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
              {uploadState.uploading ? 'Uploading…' : 'Upload resume or bio (.pdf, .docx, .txt - max 10 MB)'}
            </button>
          )}
          {uploadState.error && <p className="mt-1 form-error-text">Could not upload: {uploadState.error}</p>}
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
    resumeText: c?.resumeText || '',
    resumeExtractedText: c?.resumeExtractedText || '',
    resumeFileName: c?.resumeFileName || '',
    resumePath: c?.resumePath || '',
    resumeUploadedAt: c?.resumeUploadedAt || '',
  }
}

function SendingTab({ workspaceConfig, templates, onSave }: { workspaceConfig: any; templates: any[]; onSave: (u: any) => Promise<boolean> }) {
  const { user } = useAuth()
  const { showToast } = useToast()
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
    }))
    setSaving(false)
    return ok
  }

  return (
    <div className="space-y-5">
      <FieldGroup title="Defaults for new campaigns" hint="Pre-filled when you create a campaign.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="settings-lead-batch-size" className="label">Lead batch size</label>
            <div className="relative">
              <Target size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <ClampedNumberInput
                id="settings-lead-batch-size"
                min={LEAD_BATCH_MIN} max={LEAD_BATCH_MAX}
                value={form.leadsPerGeneration || 25}
                onChange={n => setForm((c: any) => ({ ...c, leadsPerGeneration: n }))}
                onClamp={({ raw, clamped }) => {
                  if (raw > LEAD_BATCH_MAX) {
                    showToast({
                      type: 'warning',
                      title: `Lead batch size is capped at ${LEAD_BATCH_MAX}`,
                      message: `${raw} is above the limit — using ${clamped} instead.`,
                    })
                  } else if (raw < LEAD_BATCH_MIN) {
                    showToast({
                      type: 'warning',
                      title: `Lead batch size must be at least ${LEAD_BATCH_MIN}`,
                      message: `Using ${clamped} instead.`,
                    })
                  }
                }}
                className="input pl-8"
              />
            </div>
            <p className="mt-1 text-xs text-muted">Contacts per batch. Up to {LEAD_BATCH_MAX}.</p>
          </div>
          <div>
            <label htmlFor="settings-default-template" className="label">Default template</label>
            <select
              id="settings-default-template"
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
    const path = `files/${user?.id ?? 'anonymous'}/${fileId}`
    if (user?.id) {
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
    if (meta && user?.id) await supabase.storage.from('resumes').remove([meta.path])
    setForm((c: any) => ({ ...c, files: (c.files || []).filter((f: WorkspaceFile) => f.id !== fileId) }))
  }

  return (
    <div>
      <input
        id="settings-attachment-upload"
        aria-label="Upload attachment"
        ref={fileInputRef}
        type="file"
        className="hidden"
        disabled={uploading}
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }}
      />
      {uploadError && <p className="mb-2 form-error-text">{uploadError}</p>}
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
  profile, profileLoading, onRefreshProfile, onConnectGoogle, gmailOnly = false,
}: {
  profile: any
  profileLoading: boolean
  onRefreshProfile: () => void
  onConnectGoogle: (() => void) | null
  gmailOnly?: boolean
}) {
  const { user, signOut } = useAuth()
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const hasGoogle = !!profile?.hasGoogleRefreshToken
  // Reply tracking depends on a separate Pub/Sub watch set up during the
  // OAuth callback. Users who connected before the gmail.readonly scope
  // shipped (or who hit a watch creation failure) have hasGoogle but no
  // watch — surface that explicitly so they know to reconnect.
  const hasReplyTracking = !!profile?.hasGmailWatch

  const handleDelete = async () => {
    setLoading(true); setError('')
    await deleteAccount()
    await signOut()
  }

  return (
    <div className="space-y-5">
      {!gmailOnly && (
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
      )}

      <FieldGroup title="Gmail">
        <div className="rounded-2xl border border-warm-200 bg-warm-50/60 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${hasGoogle ? 'bg-emerald-50 text-emerald-600' : 'bg-warm-100 text-muted'}`}>
                <Mail size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-dark">{hasGoogle ? 'Connected' : 'Not connected'}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {hasGoogle
                    ? 'Sparrow can send drafts and detect replies.'
                    : 'Connect to send drafts and detect replies.'}
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
              {onConnectGoogle && (
                <button type="button" onClick={onConnectGoogle} className="btn-primary text-xs">
                  {hasGoogle ? 'Reconnect' : 'Connect'}
                </button>
              )}
            </div>
          </div>
          {hasGoogle && (
            <div className="mt-3 grid gap-2 border-t border-warm-200 pt-3 sm:grid-cols-2">
              <CapabilityRow icon={SendIcon} label="Sending" enabled />
              <CapabilityRow
                icon={MessageSquare}
                label="Reply tracking"
                enabled={hasReplyTracking}
                disabledHint="Reconnect to enable"
              />
            </div>
          )}
        </div>
      </FieldGroup>

      {!gmailOnly && (
        <FieldGroup title="Danger zone">
          <div className="surface-danger flex items-start justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-dark">Delete account</p>
              <p className="mt-0.5 text-xs text-muted">
                Permanently delete your account and workspace data.
              </p>
              {error && <p className="mt-1 form-error-text">{error}</p>}
            </div>
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="btn-danger-outline"
            >
              <Trash2 size={12} /> Delete account
            </button>
          </div>
        </FieldGroup>
      )}

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
  const { showToast } = useToast()
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
    setOauthResult(error ? { kind: 'error', message: getGoogleErrorMessage(error) } : { kind: 'success' })
    if (error || success) {
      setActive('account')
      if (success) onRefreshProfile?.()
    }
    params.delete('google_error')
    params.delete('google_connected')
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
    window.history.replaceState(null, '', next)
  }, [onRefreshProfile])

  const saveWorkspace = async (updater: any, label = 'Settings saved') => {
    try {
      await onSaveWorkspaceConfig(updater)
      showToast({ type: 'success', title: label })
      return true
    } catch (err: any) {
      showToast({ type: 'error', title: 'Settings could not be saved', message: err?.message || 'Try again.' })
      return false
    }
  }

  // Wrap onConnectGoogle so any synchronous error returned by the auth
  // context (demo-mode rejection, network failure before redirect) is
  // surfaced as a banner instead of disappearing silently.
  const handleConnect = onConnectGoogle ? async () => {
    const res = await onConnectGoogle()
    if (res?.error?.message) setOauthResult({ kind: 'error', message: res.error.message })
  } : null

  const tabStatus = getSettingsTabStatus({ workspaceConfig, profile })

  return (
    <div className="page-shell max-w-5xl">
      <div className="workspace">
        <header className="border-b border-warm-200 px-6 pb-6 pt-8 sm:px-10 sm:pt-10">
          <p className="page-eyebrow">Settings</p>
          <h1 className="mt-3 font-display text-[2rem] font-semibold leading-tight text-dark">Your workspace</h1>
          <p className="mt-2 text-sm text-muted">Profile, sending, account.</p>
        </header>

        {oauthResult && (
          <div className="border-b border-warm-200 px-6 py-4 sm:px-10">
            {oauthResult.kind === 'success' && (
              profile?.hasGmailWatch ? (
                <Banner variant="success" icon={Check}>
                  Gmail connected. Sending and reply tracking are both active.
                </Banner>
              ) : (
                <Banner variant="warning" icon={AlertCircle}>
                  Gmail connected for sending. Reply tracking did not enable — try reconnecting.
                </Banner>
              )
            )}
            {oauthResult.kind === 'error' && (
              <Banner variant="danger" icon={AlertCircle}>{oauthResult.message}</Banner>
            )}
          </div>
        )}

        <div className="border-b border-warm-200 px-3 sm:px-7">
          <TabBar active={active} onChange={setActive} status={tabStatus} />
        </div>

        <div className="px-6 py-6 sm:px-10 sm:py-8">
          {active === 'profile' && (
            <ProfileTab
              workspaceConfig={workspaceConfig}
              onSave={(updater) => saveWorkspace(updater, 'Profile saved')}
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
    </div>
  )
}
