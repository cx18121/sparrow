import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { AlertCircle, Home, FileText, Settings as SettingsIcon } from 'lucide-react'
import Banner from './components/ui/Banner'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import AuthScreen from './components/Auth/AuthScreen'
import Sidebar from './components/Layout/Sidebar'

import { AppDataProvider } from './contexts/AppDataContext'
import { createWorkspaceConfig } from './lib/workspaceConfig'
import { defaultAttachmentIds } from './lib/attachments'
import { fetchProfile, saveProfile } from './lib/api'
import { readLocalJsonCache, useWorkspaceResources } from './hooks/useWorkspaceResources'

const HomePage = lazy(() => import('./components/Home/HomePage'))
const TemplatesTab = lazy(() => import('./components/Templates/TemplatesTab'))
const SettingsPage = lazy(() => import('./components/Settings/SettingsPage'))
const OnboardingScreen = lazy(() => import('./components/Onboarding/OnboardingScreen'))
const WorkspaceShell = lazy(() => import('./components/Workspace/WorkspaceShell'))
const WorkspaceOverview = lazy(() => import('./components/Workspace/sub-tabs').then(mod => ({ default: mod.OverviewTab })))
const WorkspaceLeads = lazy(() => import('./components/Workspace/sub-tabs').then(mod => ({ default: mod.LeadsTab })))
const WorkspaceContacts = lazy(() => import('./components/Workspace/sub-tabs').then(mod => ({ default: mod.ContactsSubTab })))
const WorkspaceDrafts = lazy(() => import('./components/Workspace/sub-tabs').then(mod => ({ default: mod.DraftsSubTab })))
const WorkspaceSent = lazy(() => import('./components/Workspace/sub-tabs').then(mod => ({ default: mod.SentTab })))
const WorkspaceSettings = lazy(() => import('./components/Workspace/sub-tabs').then(mod => ({ default: mod.SettingsTab })))

// Campaign status case conversion is now sealed inside src/lib/api.ts.
// The wire format never leaks past that seam.

// Per the redesign PRD the global sidebar is Home / Templates / Settings.
// Per-campaign work lives inside the workspace at /campaigns/:id/* — the
// legacy top-level Discover / Contacts / Drafts / Campaigns surfaces were
// retired in Phase 4e and old bookmarks redirect to /dashboard via the
// catch-all route below.
const TABS = [
  { id: 'dashboard', label: 'Home', icon: Home, path: '/dashboard' },
  { id: 'templates', label: 'Templates', icon: FileText, path: '/templates' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, path: '/settings' },
]

const WORKSPACE_SUB_TAB_LABEL: Record<string, string> = {
  overview: 'Overview',
  leads: 'Leads',
  drafts: 'Drafts',
  sent: 'Sent',
  settings: 'Settings',
}

const getOnboardingStorageKey = (user) => {
  if (!user) return null
  return `cf_onboarding_${user.id || user.email}`
}

const getOnboardingForceKey = (user) => {
  const storageKey = getOnboardingStorageKey(user)
  return storageKey ? `${storageKey}_editing` : null
}

const isExplicitOnboardingEdit = (value) => value === 'explicit'
const isOnboardingSessionBypass = (value) => value === 'true' || value === 'complete' || value === 'dismissed'

const hasRecoverableCompletedSetup = (profile) => {
  const config = profile?.workspaceConfig || {}
  const hasSender = Boolean(config.senderName?.trim?.())
  const hasTemplate = Boolean(
    config.templateId ||
    (config.customTemplate?.subject?.trim?.() && config.customTemplate?.body?.trim?.())
  )
  return Boolean(hasSender && hasTemplate)
}

const formatTemplateBody = (body) => {
  if (!body) return ''
  if (body.includes('<')) return body

  return body
    .split(/\n{2,}/)
    .map(block => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function AppSpinner() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface">
      <div className="dashboard-backdrop absolute inset-0" />
      <div className="relative h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )
}

function RouteFallback() {
  return (
    <div className="page-shell">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )
}

function AppShell() {
  const { user, loading, signOut, connectGoogle } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const previousOnboardingKeyRef = useRef(null)

  const [onboardingState, setOnboardingState] = useState({ loaded: false, completed: false, data: null })
  const [workspaceConfig, setWorkspaceConfig] = useState(() => createWorkspaceConfig({ user: null, templates: [] }))
  const workspaceResources = useWorkspaceResources(user)
  const {
    campaigns,
    leads,
    customContacts,
    templates,
    dataLoaded,
    hasResourceCache,
    resourceFetchErrors,
    retryResources,
    createCampaign: createCampaignHandler,
    updateCampaign: updateCampaignHandler,
    deleteCampaign: deleteCampaignHandler,
    refreshLeads,
    updateLead: updateLeadHandler,
    deleteLead: deleteLeadHandler,
    createTemplate: createTemplateHandler,
    updateTemplate: updateTemplateHandler,
    deleteTemplate: deleteTemplateHandler,
  } = workspaceResources
  const templatesRef = useRef(templates)
  const [serverProfile, setServerProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const profileRefreshPromiseRef = useRef<Promise<any> | null>(null)
  const lastProfileRefreshRef = useRef(0)
  const lastOnboardingResumePersistRef = useRef('')
  const onboardingDraftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { templatesRef.current = templates }, [templates])

  const refreshProfile = useCallback((force = false) => {
    if (!force && serverProfile && Date.now() - lastProfileRefreshRef.current < 60_000) {
      return Promise.resolve(serverProfile)
    }
    if (profileRefreshPromiseRef.current) return profileRefreshPromiseRef.current
    setProfileLoading(true)
    profileRefreshPromiseRef.current = fetchProfile()
      .then(res => {
        lastProfileRefreshRef.current = Date.now()
        setServerProfile(res?.profile ?? null)
        setProfileLoading(false)
        return res?.profile ?? null
      })
      .catch(() => {
        setProfileLoading(false)
        return null
      })
      .finally(() => {
        profileRefreshPromiseRef.current = null
      })
    return profileRefreshPromiseRef.current
  }, [serverProfile])

  useEffect(() => {
    const refreshFromEvent = () => refreshProfile(true)
    window.addEventListener('sparrow:profile-updated', refreshFromEvent)
    return () => window.removeEventListener('sparrow:profile-updated', refreshFromEvent)
  }, [refreshProfile])

  useEffect(() => () => {
    if (onboardingDraftSaveTimerRef.current) clearTimeout(onboardingDraftSaveTimerRef.current)
  }, [])

  // Workspace routes (`/campaigns/:id/<sub>`) live outside the global TABS
  // list — derive the active label from the URL segment so the top bar still
  // reads correctly inside a campaign workspace.
  const workspaceSubTabMatch = location.pathname.match(/^\/campaigns\/[^/]+\/([^/]+)/)
  const workspaceSubTabKey = workspaceSubTabMatch?.[1] ?? null
  const isInsideWorkspace = !!workspaceSubTabKey
  const globalTabItem = TABS.find(t => location.pathname.startsWith(t.path)) || TABS[0]
  const activeTab = isInsideWorkspace ? null : globalTabItem.id
  const activeTabLabel = isInsideWorkspace
    ? (WORKSPACE_SUB_TAB_LABEL[workspaceSubTabKey ?? ''] ?? '')
    : globalTabItem.label

  const handleTabChange = (tabId) => {
    const tab = TABS.find(t => t.id === tabId)
    if (tab) navigate(tab.path)
  }

  // Only the Google-OAuth-callback query params actually feed the onboarding
  // gate. Reading these out here narrows the effect's deps so it doesn't
  // re-fire on every routed query change (e.g. ?saved=1 toasts).
  const onboardingSearchParams = new URLSearchParams(location.search)
  const googleConnectedParam = onboardingSearchParams.get('google_connected')
  const googleErrorParam = onboardingSearchParams.get('google_error')
  const googleConnectReturn = !!googleConnectedParam || !!googleErrorParam

  useEffect(() => {
    if (!user) {
      if (previousOnboardingKeyRef.current) {
        sessionStorage.removeItem(`${previousOnboardingKeyRef.current}_session`)
        sessionStorage.removeItem(`${previousOnboardingKeyRef.current}_editing`)
        previousOnboardingKeyRef.current = null
      }
      setWorkspaceConfig(createWorkspaceConfig({ user: null, templates: templatesRef.current }))
      setOnboardingState({ loaded: true, completed: false, data: null })
      setServerProfile(null)
      setProfileLoading(true)
      return
    }

    const storageKey = getOnboardingStorageKey(user)
    const sessionKey = storageKey ? `${storageKey}_session` : null
    const forceKey = getOnboardingForceKey(user)
    const googleConnectedReturn = !!googleConnectedParam
    if (googleConnectedReturn && forceKey) sessionStorage.removeItem(forceKey)
    const stored = storageKey ? localStorage.getItem(storageKey) : null
    const bypassedThisSession = sessionKey ? isOnboardingSessionBypass(sessionStorage.getItem(sessionKey)) : false
    const forceOnboarding = !googleConnectReturn && forceKey
      ? isExplicitOnboardingEdit(sessionStorage.getItem(forceKey))
      : false
    let parsed = null

    if (stored) {
      try {
        parsed = JSON.parse(stored)
      } catch {
        parsed = null
      }
    }

    previousOnboardingKeyRef.current = storageKey

    // Optimistically hydrate from localStorage so the UI renders fast,
    // then reconcile against the server profile (cross-device source of truth).
    const localConfig = createWorkspaceConfig({ user, templates: templatesRef.current, data: parsed?.data || null })
    const localRecoverableSetup = hasRecoverableCompletedSetup({ workspaceConfig: parsed?.data || {} })
    const hasLocalCompletionSignal = parsed?.completed === true || bypassedThisSession
    const localCompleted = googleConnectedReturn
      ? true
      : googleConnectReturn
        ? false
        : forceOnboarding
          ? false
          : hasLocalCompletionSignal || localRecoverableSetup
    const canUseLocalGate = googleConnectReturn || forceOnboarding || hasLocalCompletionSignal || localRecoverableSetup
    setWorkspaceConfig(localConfig)
    // Never regress loaded from true→false on re-runs (e.g. token refresh causes user ref
    // to change). Once the app is visible, keep it visible while the profile re-fetches.
    setOnboardingState(prev => ({
      loaded: canUseLocalGate || prev.loaded,
      completed: localCompleted,
      data: localConfig,
    }))

    let cancelled = false
    const profileFetchStartedAt = Date.now()

    fetchProfile()
      .then((res) => {
        if (cancelled) return
        setServerProfile(res?.profile ?? null)
        setProfileLoading(false)
        if (!res?.profile) {
          setOnboardingState({ loaded: true, completed: localCompleted, data: localConfig })
          return
        }
        const latestStored = storageKey ? readLocalJsonCache(storageKey) : null
        const latestForceOnboarding = !googleConnectReturn && forceKey
          ? isExplicitOnboardingEdit(sessionStorage.getItem(forceKey))
          : false
        const latestStoredUpdatedAt = latestStored?.updatedAt ? new Date(latestStored.updatedAt).getTime() : 0
        const serverCompleted = googleConnectReturn
          ? !!res.profile.onboardingCompleted
          : !!res.profile.onboardingCompleted || hasRecoverableCompletedSetup(res.profile)
        if (latestStored?.data && latestStoredUpdatedAt > profileFetchStartedAt) {
          setWorkspaceConfig(latestStored.data)
          setOnboardingState({
            loaded: true,
            completed: googleConnectedReturn
              ? true
              : latestForceOnboarding
                ? false
                : serverCompleted || !!latestStored.completed,
            data: latestStored.data,
          })
          return
        }
        const shouldStayInOnboarding = !googleConnectReturn && latestForceOnboarding
        const serverConfig = createWorkspaceConfig({
          user,
          templates: templatesRef.current,
          data: {
            ...(res.profile.workspaceConfig || {}),
            resumePath: res.profile.resumePath || res.profile.workspaceConfig?.resumePath || '',
            resumeText: res.profile.resumeText || '',
          },
        })
        setWorkspaceConfig(serverConfig)
        setOnboardingState({
          loaded: true,
          completed: googleConnectedReturn ? true : shouldStayInOnboarding ? false : serverCompleted || localCompleted,
          data: serverConfig,
        })
      })
      .catch((err) => {
        console.warn('Profile fetch failed, using local copy', err)
        if (!cancelled) {
          setProfileLoading(false)
          setOnboardingState({ loaded: true, completed: localCompleted, data: localConfig })
        }
      })

    return () => { cancelled = true }
  }, [user, googleConnectedParam, googleErrorParam]) // eslint-disable-line react-hooks/exhaustive-deps

  const persistWorkspaceConfig = async (data, {
    completed = onboardingState.completed,
    completeSession = false,
    templatesOverride = templates,
  } = {}) => {
    if (!user) return
    if (onboardingDraftSaveTimerRef.current) {
      clearTimeout(onboardingDraftSaveTimerRef.current)
      onboardingDraftSaveTimerRef.current = null
    }

    const normalized = createWorkspaceConfig({ user, templates: templatesOverride, data })
    const storageKey = getOnboardingStorageKey(user)
    const forceKey = getOnboardingForceKey(user)
    const sessionKey = storageKey ? `${storageKey}_session` : null
    let completedAt = null

    if (storageKey) {
      try {
        completedAt = JSON.parse(localStorage.getItem(storageKey) || '{}')?.completedAt || null
      } catch {
        completedAt = null
      }
    }

    // Mirror to /api/profile so changes survive across devices. API keys are
    // host-managed and never stored in localStorage or user profile rows.
    const sanitizedConfig = {
      ...normalized,
    }

    const next = {
      completed,
      completedAt: completed ? (completedAt || new Date().toISOString()) : completedAt,
      updatedAt: new Date().toISOString(),
      data: sanitizedConfig,
    }

    await saveProfile({
      workspaceConfig: sanitizedConfig,
      defaultFilters: { leadsPerGeneration: normalized.leadsPerGeneration },
      resumePath: normalized.resumePath || null,
      resumeText: normalized.resumeText || null,
      onboardingCompleted: completed,
    })

    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next))
    if (forceKey) {
      if (completed) sessionStorage.removeItem(forceKey)
      else sessionStorage.setItem(forceKey, 'explicit')
    }
    if (sessionKey && completeSession) sessionStorage.setItem(sessionKey, 'complete')

    setWorkspaceConfig(sanitizedConfig)
    setOnboardingState({ loaded: true, completed, data: sanitizedConfig })
  }

  const saveProfileDraft = useCallback((sanitizedConfig, normalized) => {
    if (onboardingDraftSaveTimerRef.current) clearTimeout(onboardingDraftSaveTimerRef.current)
    onboardingDraftSaveTimerRef.current = setTimeout(() => {
      onboardingDraftSaveTimerRef.current = null
      saveProfile({
        workspaceConfig: sanitizedConfig,
        defaultFilters: { leadsPerGeneration: normalized.leadsPerGeneration },
        resumePath: normalized.resumePath || null,
        resumeText: normalized.resumeText || null,
        onboardingCompleted: false,
      }).catch(err => console.warn('Failed to persist onboarding draft', err))
    }, 800)
  }, [])

  const enterOnboarding = () => {
    if (!user) return
    const forceKey = getOnboardingForceKey(user)
    if (forceKey) sessionStorage.setItem(forceKey, 'explicit')
    setOnboardingState({ loaded: true, completed: false, data: workspaceConfig })
  }

  const saveOnboardingDraft = useCallback((data, templatesOverride = templates) => {
    if (!user) return

    const normalized = createWorkspaceConfig({ user, templates: templatesOverride, data })
    const sanitizedConfig = {
      ...normalized,
    }
    const storageKey = getOnboardingStorageKey(user)

    const next = {
      completed: false,
      completedAt: null,
      updatedAt: new Date().toISOString(),
      data: sanitizedConfig,
    }

    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next))
    const resumePersistSig = normalized.resumePath
      ? `${normalized.resumePath}:${normalized.resumeText || ''}`
      : ''
    if (resumePersistSig && resumePersistSig !== lastOnboardingResumePersistRef.current) {
      lastOnboardingResumePersistRef.current = resumePersistSig
      if (onboardingDraftSaveTimerRef.current) {
        clearTimeout(onboardingDraftSaveTimerRef.current)
        onboardingDraftSaveTimerRef.current = null
      }
      saveProfile({
        workspaceConfig: sanitizedConfig,
        defaultFilters: { leadsPerGeneration: normalized.leadsPerGeneration },
        resumePath: normalized.resumePath || null,
        resumeText: normalized.resumeText || null,
        onboardingCompleted: false,
      }).catch(err => console.warn('Failed to persist onboarding resume draft', err))
    } else {
      saveProfileDraft(sanitizedConfig, normalized)
    }
    setWorkspaceConfig(sanitizedConfig)
    setOnboardingState(current => ({ ...current, loaded: true, data: sanitizedConfig }))
  }, [saveProfileDraft, templates, user])

  const syncOnboardingTemplate = async (data) => {
    if (data.templateMode !== 'custom') {
      return { data, templatesOverride: templates }
    }

    const customTemplate = data.customTemplate || {}
    const hasRequiredFields = customTemplate.name?.trim() && customTemplate.subject?.trim() && customTemplate.body?.trim()

    if (!hasRequiredFields) {
      return { data: { ...data, templateMode: 'existing' }, templatesOverride: templates }
    }

    const payload = {
      name: customTemplate.name.trim(),
      subject: customTemplate.subject.trim(),
      body: formatTemplateBody(customTemplate.body.trim()),
      isShared: false,
      attachmentIds: defaultAttachmentIds(data),
    }

    // Onboarding always creates a new Template (we don't roundtrip edits
    // through here). If the user re-runs onboarding with a changed body,
    // they'll get a new row — that's fine for now.
    try {
      const created = await createTemplateHandler(payload)
      const nextTemplates = [created, ...templates.filter(t => t.id !== created.id)]
      return {
        templatesOverride: nextTemplates,
        data: { ...data, templateId: created.id, customTemplate: created },
      }
    } catch (err) {
      console.error('Failed to persist onboarding template', err)
      return { data, templatesOverride: templates }
    }
  }

  const finishOnboardingLater = useCallback(async (data) => {
    if (!user) return

    const storageKey = getOnboardingStorageKey(user)
    const forceKey = getOnboardingForceKey(user)
    const sessionKey = storageKey ? `${storageKey}_session` : null
    const { data: nextData, templatesOverride } = await syncOnboardingTemplate(data)

    await persistWorkspaceConfig(nextData, {
      completed: false,
      templatesOverride,
    })
    if (forceKey) sessionStorage.removeItem(forceKey)
    if (sessionKey) sessionStorage.setItem(sessionKey, 'dismissed')
    setOnboardingState(current => ({ ...current, completed: true }))
    navigate('/dashboard', { replace: true })
  }, [navigate, user, syncOnboardingTemplate])

  const completeOnboarding = async (data) => {
    const { data: nextData, templatesOverride } = await syncOnboardingTemplate(data)
    return persistWorkspaceConfig(nextData, {
      completed: true,
      completeSession: true,
      templatesOverride,
    })
  }

  const saveOnboardingForConnect = async (data) => {
    const { data: nextData, templatesOverride } = await syncOnboardingTemplate(data)
    return persistWorkspaceConfig(nextData, {
      completed: false,
      templatesOverride,
    })
  }

  const saveOnboardingProgress = async (data) => {
    const { data: nextData, templatesOverride } = await syncOnboardingTemplate(data)
    return persistWorkspaceConfig(nextData, {
      completed: false,
      templatesOverride,
    })
  }

  const updateWorkspaceConfig = async (dataOrUpdater) => {
    const current = workspaceConfig || createWorkspaceConfig({ user, templates })
    const nextData = typeof dataOrUpdater === 'function' ? dataOrUpdater(current) : dataOrUpdater
    return persistWorkspaceConfig(nextData)
  }

  if (loading) {
    return <AppSpinner />
  }

  if (!user) {
    return <AuthScreen />
  }

  if (user && !onboardingState.loaded) {
    return <AppSpinner />
  }

  if (user && !onboardingState.completed) {
    return (
      <Suspense fallback={<AppSpinner />}>
        <OnboardingScreen
          user={user}
          templates={templates}
          initialData={workspaceConfig}
          profile={serverProfile}
          profileLoading={profileLoading}
          onRefreshProfile={refreshProfile}
          onConnectGoogle={connectGoogle}
          initialStepIndex={googleConnectReturn ? 2 : 0}
          onSaveDraft={saveOnboardingDraft}
          onSaveProgress={saveOnboardingProgress}
          onFinishLater={finishOnboardingLater}
          onSaveForConnect={saveOnboardingForConnect}
          onComplete={completeOnboarding}
          onLogout={signOut}
        />
      </Suspense>
    )
  }

  return (
    <AppDataProvider value={{
      campaigns, leads, customContacts, templates,
      dataLoaded, hasResourceCache,
      createCampaign: createCampaignHandler,
      updateCampaign: updateCampaignHandler,
      deleteCampaign: deleteCampaignHandler,
      refreshLeads,
      updateLead: updateLeadHandler,
      deleteLead: deleteLeadHandler,
      createTemplate: createTemplateHandler,
      updateTemplate: updateTemplateHandler,
      deleteTemplate: deleteTemplateHandler,
    }}>
      <div className="flex min-h-screen bg-surface md:h-screen md:overflow-hidden">
        <div className="dashboard-backdrop fixed inset-0" />
        <Sidebar
          activeTab={activeTab}
          tabs={TABS}
          onTabChange={handleTabChange}
        />

        <main className="relative z-10 flex-1 overflow-y-auto bg-surface pb-24 md:pb-0">
          {resourceFetchErrors.length > 0 && (
            <div className="px-4 pt-3 sm:px-6 lg:px-8">
              <Banner variant="warning" icon={AlertCircle}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Some data could not refresh ({resourceFetchErrors.join(', ')}). Showing cached results.
                  </span>
                  <button
                    type="button"
                    onClick={retryResources}
                    className="shrink-0 text-xs font-semibold underline-offset-2 hover:underline"
                  >
                    Retry
                  </button>
                </div>
              </Banner>
            </div>
          )}
          {/* The previous sticky header bar (h-14, bg-neutral-100/90) sat at
              the top of every non-workspace surface and just repeated the
              active tab label. The sidebar already conveys which tab is
              active and the page content carries its own title, so the bar
              was visual noise. Removed. */}
          <div className="flex min-h-screen flex-col">
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={
                  <HomePage workspaceConfig={workspaceConfig} />
                } />
                <Route path="/campaigns/:id" element={<WorkspaceShell workspaceConfig={workspaceConfig} profile={serverProfile} profileLoading={profileLoading} onRefreshProfile={refreshProfile} />}>
                  <Route index element={<Navigate to="overview" replace />} />
                  <Route path="overview" element={<WorkspaceOverview />} />
                  <Route path="leads" element={<WorkspaceLeads />} />
                  <Route path="contacts" element={<WorkspaceContacts />} />
                  <Route path="drafts" element={<WorkspaceDrafts />} />
                  <Route path="sent" element={<WorkspaceSent />} />
                  <Route path="settings" element={<WorkspaceSettings />} />
                  <Route path="*" element={<Navigate to="overview" replace />} />
                </Route>
                <Route path="/templates" element={
                  <TemplatesTab workspaceConfig={workspaceConfig} />
                } />
                <Route path="/settings" element={
                  <SettingsPage
                    workspaceConfig={workspaceConfig}
                    onSaveWorkspaceConfig={updateWorkspaceConfig}
                    templates={templates}
                    profile={serverProfile}
                    profileLoading={profileLoading}
                    onRefreshProfile={refreshProfile}
                    onGoToOnboarding={enterOnboarding}
                    onConnectGoogle={connectGoogle}
                    onNavigate={handleTabChange}
                  />
                } />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
            <footer className="mt-auto py-6 text-center text-xs text-muted">
              Made by{' '}
              <a
                href="https://www.cornellgenai.dev/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary transition-colors hover:text-primary/80"
              >
                Cornell Generative AI
              </a>
              <span className="mx-2 opacity-40">·</span>
              <a href="/privacy" className="transition-colors hover:text-dark">Privacy Policy</a>
              <span className="mx-2 opacity-40">·</span>
              <a href="/terms" className="transition-colors hover:text-dark">Terms of Service</a>
            </footer>
          </div>
        </main>
      </div>
    </AppDataProvider>
  )
}

function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface px-6 py-12">
      <div className="mx-auto max-w-2xl">
        <a href="/" className="mb-8 inline-block font-display text-lg font-semibold text-dark">Sparrow</a>
        <h1 className="font-display text-3xl font-semibold text-dark">{title}</h1>
        <p className="mt-1 text-sm text-muted">Last updated: May 2, 2026</p>
        <div className="mt-8 space-y-6 text-sm leading-7 text-dark/80">{children}</div>
      </div>
    </div>
  )
}

function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>Sparrow ("we", "us", or "our") operates as an AI-powered cold email automation tool. This Privacy Policy explains how we collect, use, and protect your information.</p>
      <h2 className="font-display text-base font-semibold text-dark">Information We Collect</h2>
      <p>We collect information you provide directly, including your name, email address, and workspace configuration when you create an account. We also collect information about leads and contacts you add or discover through the platform.</p>
      <h2 className="font-display text-base font-semibold text-dark">How We Use Your Information</h2>
      <p>We use your information to provide and improve the Sparrow service, generate email drafts using AI, and send campaigns on your behalf. We do not sell your personal information to third parties.</p>
      <h2 className="font-display text-base font-semibold text-dark">Google OAuth</h2>
      <p>If you sign in with Google, we receive your name and email address from Google. We use this solely to authenticate your account. We do not access your Gmail, contacts, or any other Google data beyond what is required for authentication.</p>
      <h2 className="font-display text-base font-semibold text-dark">Data Retention</h2>
      <p>We retain your account data for as long as your account is active. You may request deletion of your data at any time by contacting us.</p>
      <h2 className="font-display text-base font-semibold text-dark">Contact</h2>
      <p>For questions about this policy, contact us at <a href="mailto:charlie.l.xue@gmail.com" className="text-primary underline underline-offset-2">charlie.l.xue@gmail.com</a>.</p>
    </LegalPage>
  )
}

function TermsOfService() {
  return (
    <LegalPage title="Terms of Service">
      <p>By using Sparrow, you agree to these Terms of Service. Please read them carefully.</p>
      <h2 className="font-display text-base font-semibold text-dark">Use of the Service</h2>
      <p>Sparrow is provided for legitimate business outreach purposes only. You agree not to use Sparrow to send spam, harass individuals, or violate any applicable laws including CAN-SPAM, GDPR, or CASL.</p>
      <h2 className="font-display text-base font-semibold text-dark">Your Account</h2>
      <p>You are responsible for maintaining the security of your account and all activity that occurs under it. You must provide accurate information when creating your account.</p>
      <h2 className="font-display text-base font-semibold text-dark">Intellectual Property</h2>
      <p>Sparrow and its original content remain the property of its creators. Email content you create using the platform belongs to you.</p>
      <h2 className="font-display text-base font-semibold text-dark">Disclaimer</h2>
      <p>Sparrow is provided "as is" without warranties of any kind. We are not liable for the outcomes of emails sent through the platform.</p>
      <h2 className="font-display text-base font-semibold text-dark">Contact</h2>
      <p>For questions about these terms, contact us at <a href="mailto:charlie.l.xue@gmail.com" className="text-primary underline underline-offset-2">charlie.l.xue@gmail.com</a>.</p>
    </LegalPage>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="*" element={
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      } />
    </Routes>
  )
}
