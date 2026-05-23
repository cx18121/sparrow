import { Upload, User } from 'lucide-react'
import { RoleTiles } from '../../ui/RoleTiles'
import type { RoleFamily } from '../../../types/roleFamilies'
import StepHeader, { TOTAL_STEPS } from '../StepHeader'

export default function AboutStep({
  form, updateField, onUploadResume, uploadState, showNameError, onPickRole,
}: {
  form: { senderName: string; resumeText: string; resumeFileName: string; targetRole: RoleFamily | null }
  updateField: (key: string, value: unknown) => void
  onUploadResume: (file: File) => void
  uploadState: { uploading: boolean; error: string | null }
  showNameError: boolean
  onPickRole: (role: RoleFamily) => void
}) {
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
        <div>
          <label htmlFor="onboarding-sender-name" className="label">Name <span className="text-red-600">*</span></label>
          <div className="relative">
            <User size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              id="onboarding-sender-name"
              value={form.senderName}
              onChange={e => updateField('senderName', e.target.value)}
              placeholder="Maya Chen"
              className={`input pl-8 ${showNameError ? 'input-error' : ''}`}
              aria-invalid={showNameError}
            />
          </div>
          {showNameError && (
            <p className="mt-2 form-error-text">Name is required.</p>
          )}
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

        {/* Role picker — drives Apollo's title scope for the user's
            campaigns. Always-visible tiles here (not the compact summary
            the wizard uses) because onboarding is *establishing* the
            default, not overriding it — discoverability beats compactness
            during first-run setup. */}
        <div className="pt-2">
          <label className="label" id="onboarding-role-label">
            What role are you looking for?
          </label>
          <div className="mt-2" role="group" aria-labelledby="onboarding-role-label">
            <RoleTiles value={form.targetRole} onChange={onPickRole} />
          </div>
        </div>
      </div>
    </div>
  )
}
