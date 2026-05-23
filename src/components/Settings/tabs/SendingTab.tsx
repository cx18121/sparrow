import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Paperclip, Target, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { useUnsavedChanges } from '../../../hooks/useUnsavedChanges'
import { LEAD_BATCH_MAX, LEAD_BATCH_MIN, type WorkspaceConfig } from '../../../lib/workspaceConfig'
import type { Template } from '../../../types/api'
import { ClampedNumberInput, FieldGroup, SaveBar, type SaveWorkspaceConfig } from '../_primitives'

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

export default function SendingTab({ workspaceConfig, templates, onSave, onDirtyChange }: {
  workspaceConfig: WorkspaceConfig
  templates: Template[]
  onSave: SaveWorkspaceConfig
  onDirtyChange?: (dirty: boolean) => void
}) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [form, setForm] = useState(workspaceConfig)
  const [saving, setSaving] = useState(false)
  const initial = useMemo(() => JSON.stringify(pickSendingFields(workspaceConfig)), [workspaceConfig])
  const dirty = JSON.stringify(pickSendingFields(form)) !== initial
  useUnsavedChanges(dirty)
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

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
