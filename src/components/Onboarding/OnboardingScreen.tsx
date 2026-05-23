import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import Banner from '../ui/Banner'
import { createWorkspaceConfig, profileResumeTextFromWorkspace } from '../../lib/workspaceConfig'
import { fetchPreviewFitAngle } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { canExtractResumeText, extractResumeTextFromFile } from '../../lib/resumeText'
import type { RoleFamily } from '../../types/roleFamilies'
import { stripHtml } from './_helpers'
import { TOTAL_STEPS } from './StepHeader'
import AboutStep from './steps/AboutStep'
import TemplateStep from './steps/TemplateStep'
import GmailStep from './steps/GmailStep'

const STEP_LABELS = ['About', 'Template', 'Gmail']

// Debounce delay for the preview fit-angle fetch. Long enough that
// users pasting/typing a resume don't fire a request per keystroke;
// short enough that Step 2 reflects their resume by the time they
// navigate to it.
const PREVIEW_DEBOUNCE_MS = 700

// Bump when ANTHROPIC_PREVIEW_DOSSIER changes server-side so cached
// results against the old dossier are invalidated automatically.
const PREVIEW_CACHE_VERSION = 'v1'

// djb2 — small, dependency-free, good enough as a cache discriminator.
// Collisions just mean a refetch, which is harmless.
function previewCacheKey(resumeText: string): string {
  let h = 5381
  for (let i = 0; i < resumeText.length; i++) {
    h = ((h << 5) + h + resumeText.charCodeAt(i)) | 0
  }
  return `cf_preview_fit_angle_${PREVIEW_CACHE_VERSION}_${h}`
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
  const [templateAttempted, setTemplateAttempted] = useState(false)
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
  // Exposed by the preview effect so nextStep/goToStep can fire the fetch
  // immediately instead of waiting out the remaining debounce window.
  const runPreviewNowRef = useRef<(() => void) | null>(null)
  const previewInflightRef = useRef(false)

  useEffect(() => {
    const text = profileResumeTextFromWorkspace(form).trim()
    if (text.length === 0) {
      previewInflightRef.current = false
      setAiPreview({ featureLine: null, fitAngle: null })
      setIsLoadingPreview(false)
      return
    }

    const cacheKey = previewCacheKey(text)
    try {
      const raw = sessionStorage.getItem(cacheKey)
      if (raw) {
        const cached = JSON.parse(raw) as { featureLine: string | null; fitAngle: string | null }
        setAiPreview(cached)
        setIsLoadingPreview(false)
        return
      }
    } catch {}

    if (previewInflightRef.current) return

    setIsLoadingPreview(true)
    let cancelled = false
    let fired = false

    const doFetch = () => {
      if (fired || previewInflightRef.current) return
      fired = true
      previewInflightRef.current = true
      fetchPreviewFitAngle(text)
        .then(res => {
          previewInflightRef.current = false
          if (cancelled) return
          const result = { featureLine: res?.featureLine ?? null, fitAngle: res?.fitAngle ?? null }
          setAiPreview(result)
          setIsLoadingPreview(false)
          try { sessionStorage.setItem(cacheKey, JSON.stringify(result)) } catch {}
        })
        .catch(err => {
          previewInflightRef.current = false
          console.error('[preview] fetchPreviewFitAngle failed:', err)
          if (!cancelled) {
            setAiPreview({ featureLine: null, fitAngle: null })
            setIsLoadingPreview(false)
          }
        })
    }

    runPreviewNowRef.current = doFetch
    const timer = setTimeout(doFetch, PREVIEW_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      runPreviewNowRef.current = null
      if (!fired) previewInflightRef.current = false
    }
  }, [form.resumeText, form.resumeExtractedText])

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

  const selectedTemplate = useMemo(() => {
    const personalTemplates = templates.filter((t: any) => t?.userId !== '__library__')
    return personalTemplates.find(template => template.id === form.templateId) || personalTemplates[0] || null
  }, [form.templateId, templates])

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
    if (!extractedResumeText && !profileResumeTextFromWorkspace(form).trim()) {
      setResumeUpload({ uploading: false, error: 'Could not read text from this resume. Try a text-based PDF, DOCX, or TXT file.' })
      return
    }

    if (!user?.id) {
      markUserEdited()
      setForm(current => ({
        ...current,
        resumeExtractedText: extractedResumeText || current.resumeExtractedText || '',
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
      resumeExtractedText: extractedResumeText || current.resumeExtractedText || '',
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
    if (stepIndex === 1 && form.templateMode !== 'existing' && !form.customTemplate.body.trim()) {
      setTemplateAttempted(true)
      return
    }
    // Skip the remaining debounce — start the Claude call now so it's in-flight
    // while the user reads step 2 instead of starting after they arrive.
    if (stepIndex === 0) runPreviewNowRef.current?.()
    if (stepIndex < steps.length - 1) {
      if (isSaving || resumeUpload.uploading) return
      const saved = await persistCurrentProgress()
      if (!saved) return
    }
    setTemplateAttempted(false)
    setStepIndex(index => Math.min(index + 1, steps.length - 1))
  }
  const prevStep = () => setStepIndex(index => Math.max(index - 1, 0))
  const goToStep = async (index) => {
    if (index > 0 && !isSenderNameValid) {
      setSenderNameAttempted(true)
      setStepIndex(0)
      return
    }
    if (index > 1 && form.templateMode !== 'existing' && !form.customTemplate.body.trim()) {
      setTemplateAttempted(true)
      setStepIndex(1)
      return
    }
    if (stepIndex === 0 && index > 0) runPreviewNowRef.current?.()
    if (stepIndex < steps.length - 1 && index > stepIndex) {
      if (isSaving || resumeUpload.uploading) return
      const saved = await persistCurrentProgress()
      if (!saved) return
    }
    setTemplateAttempted(false)
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
      onPickRole={(role: RoleFamily) => updateField('targetRole', role)}
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
      showBodyError={templateAttempted && form.templateMode !== 'existing' && !form.customTemplate.body.trim()}
    />,
    <GmailStep
      key="gmail"
      hasGoogle={!!profile?.hasGoogleRefreshToken}
      hasReplyTracking={!!profile?.hasGmailWatch}
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
                  index === stepIndex ? 'w-8 bg-primary' : 'w-2.5 bg-warm-300 group-hover:bg-warm-400'
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
              <div className="flex flex-col items-end gap-2">
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
                {!profile?.hasGoogleRefreshToken && (
                  <button
                    type="button"
                    onClick={() => finish(false)}
                    disabled={isSaving}
                    className="text-xs text-muted hover:text-dark transition-colors disabled:opacity-50"
                  >
                    Continue without Gmail →
                  </button>
                )}
              </div>
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
