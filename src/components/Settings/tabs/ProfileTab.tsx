import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, UploadCloud } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { canExtractResumeText, extractResumeTextFromFile } from '../../../lib/resumeText'
import { useUnsavedChanges } from '../../../hooks/useUnsavedChanges'
import type { WorkspaceConfig } from '../../../lib/workspaceConfig'
import type { RoleFamily } from '../../../types/roleFamilies'
import { RoleTiles } from '../../ui/RoleTiles'
import { FieldGroup, SaveBar, type SaveWorkspaceConfig } from '../_primitives'

function pickProfileFields(c: any) {
  return {
    senderName: c?.senderName || '',
    resumeText: c?.resumeText || '',
    resumeExtractedText: c?.resumeExtractedText || '',
    resumeFileName: c?.resumeFileName || '',
    resumePath: c?.resumePath || '',
    resumeUploadedAt: c?.resumeUploadedAt || '',
    // Validation of the value lives in normalizeRoleFamily on the
    // server side (parseWorkspaceConfig); here we just round-trip
    // whatever's set so the dirty-state comparison can fire on changes.
    targetRole: c?.targetRole || null,
  }
}

export default function ProfileTab({ workspaceConfig, onSave, onDirtyChange }: {
  workspaceConfig: WorkspaceConfig
  onSave: SaveWorkspaceConfig
  onDirtyChange?: (dirty: boolean) => void
}) {
  const { user } = useAuth()
  const [form, setForm] = useState(workspaceConfig)
  const [saving, setSaving] = useState(false)
  const [uploadState, setUploadState] = useState({ uploading: false, error: null as string | null })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const initial = useMemo(() => JSON.stringify(pickProfileFields(workspaceConfig)), [workspaceConfig])
  const dirty = JSON.stringify(pickProfileFields(form)) !== initial
  useUnsavedChanges(dirty)
  // Bubble dirty state up so SettingsPage can confirm before in-app
  // navigation (tab switches). beforeunload only catches tab close.
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

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

      <FieldGroup
        title="Target role"
        hint="Default for new campaigns. Override per-campaign in the wizard."
      >
        <RoleTiles
          value={form.targetRole ?? null}
          onChange={(role: RoleFamily) => field('targetRole', role)}
        />
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
