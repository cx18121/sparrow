import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { LayoutDashboard, Search, Users, Mail, FileText, Settings as SettingsIcon, Inbox } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import AuthScreen from './components/Auth/AuthScreen'
import Sidebar from './components/Layout/Sidebar'
import DashboardTab from './components/Dashboard/DashboardTab'
import LeadDiscoveryTab from './components/LeadDiscovery/LeadDiscoveryTab'
import CampaignsTab from './components/Campaigns/CampaignsTab'
import ContactsTab from './components/Contacts/ContactsTab'
import TemplatesTab from './components/Templates/TemplatesTab'
import SettingsPage from './components/Settings/SettingsPage'
import DraftsTab from './components/Drafts/DraftsTab'
import OnboardingScreen from './components/Onboarding/OnboardingScreen'

import { createWorkspaceConfig } from './lib/workspaceConfig'
import {
  fetchProfile, saveProfile,
  fetchTemplates, createTemplate, updateTemplate, deleteTemplate,
  fetchCampaigns, createCampaign, updateCampaign, deleteCampaign,
  fetchLeads, updateLead, deleteLead,
  fetchCustomContacts, createCustomContact, deleteCustomContact,
  apiGetAuth,
} from './lib/api'

// DB stores campaign status as UPPERCASE; the UI uses lowercase.
const campaignToUi = (c) => c && { ...c, status: (c.status || 'DRAFT').toLowerCase() }
const campaignToApi = (c) => {
  if (!c) return c
  const { status, ...rest } = c
  return status ? { ...rest, status: status.toUpperCase() } : rest
}

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { id: 'campaigns', label: 'Campaigns', icon: Mail, path: '/campaigns' },
  { id: 'leads', label: 'Discover', icon: Search, path: '/leads' },
  { id: 'contacts', label: 'Contacts', icon: Users, path: '/contacts' },
  { id: 'drafts', label: 'Drafts', icon: Inbox, path: '/drafts' },
  { id: 'templates', label: 'Templates', icon: FileText, path: '/templates' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, path: '/settings' },
]

const getOnboardingStorageKey = (user) => {
  if (!user) return null
  return `cf_onboarding_${user.id || user.email}`
}

const getOnboardingForceKey = (user) => {
  const storageKey = getOnboardingStorageKey(user)
  return storageKey ? `${storageKey}_editing` : null
}

const getResourceCacheKey = (user) => {
  if (!user) return null
  return `cf_resource_cache_${typeof user === 'string' ? user : user.id || user.email}`
}

const readJsonCache = (key) => {
  if (!key) return null
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

const writeJsonCache = (key, data) => {
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // Cache writes should never block the app.
  }
}

const formatTemplateBody = (body) => {
  if (!body) return ''
  if (body.includes('<')) return body

  return body
    .split(/\n{2,}/)
    .map(block => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function AppShell() {
  const { user, loading, signOut, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const previousOnboardingKeyRef = useRef(null)

  const [onboardingState, setOnboardingState] = useState({ loaded: false, completed: false, data: null })
  const [workspaceConfig, setWorkspaceConfig] = useState(() => createWorkspaceConfig({ user: null, templates: [] }))

  // Server-backed resource state. Hydrated from /api/* once the user is known.
  const [campaigns, setCampaigns] = useState([])
  const [leads, setLeads] = useState([])
  const [customContacts, setCustomContacts] = useState([])
  const [templates, setTemplates] = useState([])
  const [dataLoaded, setDataLoaded] = useState(false)
  const [hasResourceCache, setHasResourceCache] = useState(false)

  const activeTabItem = TABS.find(t => location.pathname.startsWith(t.path)) || TABS[0]
  const activeTab = activeTabItem.id

  const handleTabChange = (tabId) => {
    const tab = TABS.find(t => t.id === tabId)
    if (tab) navigate(tab.path)
  }

  useEffect(() => {
    if (!user) {
      if (previousOnboardingKeyRef.current) {
        sessionStorage.removeItem(`${previousOnboardingKeyRef.current}_session`)
        sessionStorage.removeItem(`${previousOnboardingKeyRef.current}_editing`)
        previousOnboardingKeyRef.current = null
      }
      setWorkspaceConfig(createWorkspaceConfig({ user: null, templates }))
      setOnboardingState({ loaded: true, completed: false, data: null })
      return
    }

    const storageKey = getOnboardingStorageKey(user)
    const sessionKey = storageKey ? `${storageKey}_session` : null
    const forceKey = getOnboardingForceKey(user)
    const stored = storageKey ? localStorage.getItem(storageKey) : null
    const completedThisSession = sessionKey ? sessionStorage.getItem(sessionKey) === 'true' : false
    const forceOnboarding = forceKey ? sessionStorage.getItem(forceKey) === 'true' : false
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
    const localConfig = createWorkspaceConfig({ user, templates, data: parsed?.data || null })
    const localCompleted = forceOnboarding ? false : parsed?.completed || completedThisSession
    setWorkspaceConfig(localConfig)
    setOnboardingState({ loaded: true, completed: localCompleted, data: localConfig })

    let cancelled = false
    const profileFetchStartedAt = Date.now()

    fetchProfile()
      .then((res) => {
        if (cancelled || !res?.profile) return
        const latestStored = storageKey ? readJsonCache(storageKey) : null
        const latestForceOnboarding = forceKey ? sessionStorage.getItem(forceKey) === 'true' : false
        const latestStoredUpdatedAt = latestStored?.updatedAt ? new Date(latestStored.updatedAt).getTime() : 0
        if (latestStored?.data && latestStoredUpdatedAt > profileFetchStartedAt) {
          setWorkspaceConfig(latestStored.data)
          setOnboardingState({
            loaded: true,
            completed: latestForceOnboarding ? false : !!latestStored.completed,
            data: latestStored.data,
          })
          return
        }
        const shouldStayInOnboarding = latestForceOnboarding || latestStored?.completed === false
        const serverConfig = createWorkspaceConfig({
          user,
          templates,
          data: {
            ...(res.profile.workspaceConfig || {}),
            resumePath: res.profile.resumePath || res.profile.workspaceConfig?.resumePath || '',
            resumeText: res.profile.resumeText || '',
          },
        })
        setWorkspaceConfig(serverConfig)
        setOnboardingState({
          loaded: true,
          completed: shouldStayInOnboarding ? false : !!res.profile.onboardingCompleted || localCompleted,
          data: serverConfig,
        })
      })
      .catch((err) => {
        // Non-fatal: localStorage hydration is already in place.
        console.warn('Profile fetch failed, using local copy', err)
      })

    return () => { cancelled = true }
  }, [user, templates])

  // Hydrate templates / sequences / campaigns / leads from the API after auth.
  // Check both React user state and module-level auth (set synchronously before state updates).
  useEffect(() => {
    const { userId } = apiGetAuth()
    const effectiveUser = user || userId
    if (!effectiveUser) {
      setTemplates([])
      setCampaigns([])
      setLeads([])
      setCustomContacts([])
      setDataLoaded(false)
      setHasResourceCache(false)
      return
    }

    let cancelled = false
    const cacheKey = getResourceCacheKey(effectiveUser)
    const cached = readJsonCache(cacheKey)
    const cachedData = cached?.data || null

    if (cachedData) {
      setTemplates(cachedData.templates || [])
      setCampaigns((cachedData.campaigns || []).map(campaignToUi))
      setLeads(cachedData.leads || [])
      setCustomContacts(cachedData.customContacts || [])
      setDataLoaded(true)
      setHasResourceCache(true)
    } else {
      setDataLoaded(false)
      setHasResourceCache(false)
    }

    const keepCachedOnError = (label, request) =>
      request
        .then(res => ({ ok: true, res }))
        .catch(e => {
          console.error(`${label} failed:`, e.message)
          return { ok: false, res: null }
        })

    Promise.all([
      keepCachedOnError('fetchTemplates', fetchTemplates()),
      keepCachedOnError('fetchCampaigns', fetchCampaigns()),
      keepCachedOnError('fetchLeads', fetchLeads()),
      keepCachedOnError('fetchCustomContacts', fetchCustomContacts()),
    ]).then(([t, c, l, cc]) => {
      if (cancelled) return
      setTemplates(t.ok ? (t.res?.items || []) : (cachedData?.templates || []))
      setCampaigns((c.ok ? (c.res?.items || []) : (cachedData?.campaigns || [])).map(campaignToUi))
      setLeads(l.ok ? (l.res?.items || []) : (cachedData?.leads || []))
      setCustomContacts(cc.ok ? (cc.res?.items || []) : (cachedData?.customContacts || []))
      setDataLoaded(true)
      setHasResourceCache(true)
    })

    return () => { cancelled = true }
  }, [user])

  useEffect(() => {
    const { userId } = apiGetAuth()
    const effectiveUser = user || userId
    if (!effectiveUser || !dataLoaded) return
    writeJsonCache(getResourceCacheKey(effectiveUser), {
      cachedAt: new Date().toISOString(),
      data: { templates, campaigns, leads, customContacts },
    })
  }, [campaigns, customContacts, dataLoaded, leads, templates, user])

  // ── Templates ──
  const createTemplateHandler = async (data) => {
    const tempId = `temp-${Date.now()}`
    const optimistic = { ...data, id: tempId }
    setTemplates(prev => [optimistic, ...prev])
    try {
      const created = await createTemplate(data)
      setTemplates(prev => prev.map(t => t.id === tempId ? created : t))
      return created
    } catch (err) {
      setTemplates(prev => prev.filter(t => t.id !== tempId))
      throw err
    }
  }
  const updateTemplateHandler = async (data) => {
    const prev = templates
    setTemplates(curr => curr.map(t => t.id === data.id ? { ...t, ...data } : t))
    try {
      const updated = await updateTemplate(data)
      setTemplates(curr => curr.map(t => t.id === updated.id ? updated : t))
      return updated
    } catch (err) {
      setTemplates(() => prev)
      throw err
    }
  }
  const deleteTemplateHandler = async (id) => {
    const prev = templates
    setTemplates(curr => curr.filter(t => t.id !== id))
    try {
      await deleteTemplate(id)
    } catch (err) {
      setTemplates(() => prev)
      throw err
    }
  }

  // ── Campaigns ──
  const createCampaignHandler = async (data) => {
    const tempId = `temp-${Date.now()}`
    const optimistic = { ...data, id: tempId, status: data.status || 'draft' }
    setCampaigns(prev => [optimistic, ...prev])
    try {
      const created = await createCampaign(campaignToApi(data))
      const ui = campaignToUi(created)
      setCampaigns(prev => prev.map(c => c.id === tempId ? ui : c))
      return ui
    } catch (err) {
      setCampaigns(prev => prev.filter(c => c.id !== tempId))
      throw err
    }
  }
  const updateCampaignHandler = async (data) => {
    const prev = campaigns
    setCampaigns(curr => curr.map(c => c.id === data.id ? { ...c, ...data } : c))
    try {
      const updated = campaignToUi(await updateCampaign(campaignToApi(data)))
      setCampaigns(curr => curr.map(c => c.id === updated.id ? updated : c))
      return updated
    } catch (err) {
      setCampaigns(() => prev)
      throw err
    }
  }
  const deleteCampaignHandler = async (id) => {
    const prev = campaigns
    setCampaigns(curr => curr.filter(c => c.id !== id))
    try {
      await deleteCampaign(id)
    } catch (err) {
      setCampaigns(() => prev)
      throw err
    }
  }

  // ── Leads (Contacts tab) ──
  const refreshLeads = async () => {
    const res = await fetchLeads()
    setLeads(res?.items || [])
  }
  const updateLeadHandler = async (data) => {
    const prev = leads
    setLeads(curr => curr.map(l => l.id === data.id ? { ...l, ...data } : l))
    try {
      const updated = await updateLead(data)
      setLeads(curr => curr.map(l => l.id === updated.id ? { ...l, ...updated } : l))
      return updated
    } catch (err) {
      setLeads(() => prev)
      throw err
    }
  }
  const deleteLeadHandler = async (id) => {
    const prev = leads
    setLeads(curr => curr.filter(l => l.id !== id))
    try {
      await deleteLead(id)
    } catch (err) {
      setLeads(() => prev)
      throw err
    }
  }

  // ── Custom Contacts ──
  const createCustomContactHandler = async (data) => {
    const created = await createCustomContact(data)
    setCustomContacts(prev => [created, ...prev])
    return created
  }
  const deleteCustomContactHandler = async (id) => {
    const prev = customContacts
    setCustomContacts(curr => curr.filter(c => c.id !== id))
    try {
      await deleteCustomContact(id)
    } catch (err) {
      setCustomContacts(() => prev)
      throw err
    }
  }

  const persistWorkspaceConfig = async (data, {
    completed = onboardingState.completed,
    completeSession = false,
    templatesOverride = templates,
  } = {}) => {
    if (!user) return

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

    // Mirror to /api/profile so changes survive across devices.
    // The Claude key is stripped from local/server workspace config and sent
    // separately so /api/profile can encrypt it before insertion.
    const claudeKey = normalized.apiKeys?.claude || null
    const sanitizedConfig = {
      ...normalized,
      apiKeys: {}, // never persist any API keys in localStorage or workspace_config
    }

    const next = {
      completed,
      completedAt: completed ? (completedAt || new Date().toISOString()) : completedAt,
      updatedAt: new Date().toISOString(),
      data: sanitizedConfig,
    }

    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next))
    if (forceKey) {
      if (completed) sessionStorage.removeItem(forceKey)
      else sessionStorage.setItem(forceKey, 'true')
    }
    if (sessionKey && completeSession) sessionStorage.setItem(sessionKey, 'true')

    setWorkspaceConfig(sanitizedConfig)
    setOnboardingState({ loaded: true, completed, data: sanitizedConfig })

    await saveProfile({
      workspaceConfig: sanitizedConfig,
      defaultFilters: { leadsPerGeneration: normalized.leadsPerGeneration },
      resumePath: normalized.resumePath || null,
      resumeText: normalized.resumeText || null,
      ...(claudeKey ? { claudeApiKey: claudeKey } : {}),
      onboardingCompleted: completed,
    })
  }

  const saveOnboardingDraft = useCallback((data, templatesOverride = templates) => {
    if (!user) return

    const normalized = createWorkspaceConfig({ user, templates: templatesOverride, data })
    const sanitizedConfig = {
      ...normalized,
      apiKeys: {},
    }
    const storageKey = getOnboardingStorageKey(user)
    const forceKey = getOnboardingForceKey(user)
    let previous = null

    if (storageKey) {
      try {
        previous = JSON.parse(localStorage.getItem(storageKey) || 'null')
      } catch {
        previous = null
      }
    }

    const next = {
      completed: false,
      completedAt: null,
      updatedAt: new Date().toISOString(),
      data: sanitizedConfig,
    }

    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next))
    if (forceKey) sessionStorage.setItem(forceKey, 'true')

    setWorkspaceConfig(sanitizedConfig)
    setOnboardingState(current => ({ ...current, loaded: true, data: sanitizedConfig }))
  }, [templates, user])

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

  const completeOnboarding = async (data) => {
    const { data: nextData, templatesOverride } = await syncOnboardingTemplate(data)
    return persistWorkspaceConfig(nextData, {
      completed: true,
      completeSession: true,
      templatesOverride,
    })
  }

  const updateWorkspaceConfig = async (dataOrUpdater) => {
    const current = workspaceConfig || createWorkspaceConfig({ user, templates })
    const nextData = typeof dataOrUpdater === 'function' ? dataOrUpdater(current) : dataOrUpdater
    return persistWorkspaceConfig(nextData)
  }

  if (loading) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface">
        <div className="dashboard-backdrop absolute inset-0" />
        <div className="relative h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <AuthScreen />
  }

  if (user && !onboardingState.loaded) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface">
        <div className="dashboard-backdrop absolute inset-0" />
        <div className="relative h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (user && !onboardingState.completed) {
    return (
      <OnboardingScreen
        user={user}
        templates={templates}
        initialData={workspaceConfig}
        onSaveDraft={saveOnboardingDraft}
        onComplete={completeOnboarding}
        onLogout={signOut}
      />
    )
  }

  return (
    <div className="flex min-h-screen bg-surface md:h-screen md:overflow-hidden">
      <div className="dashboard-backdrop fixed inset-0" />
      <Sidebar
        activeTab={activeTab}
        tabs={TABS}
        onTabChange={handleTabChange}
      />

      <main className="relative z-10 flex-1 overflow-y-auto pb-24 md:pb-0">
        <div className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-slate-100 bg-white/88 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-semibold tracking-[-0.03em] text-dark sm:text-xl">
              {activeTabItem.label}
            </h1>
          </div>
          {dataLoaded && (
            <div className="hidden items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-medium text-muted sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Synced
            </div>
          )}
        </div>
        <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
          <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={
                <DashboardTab
                  campaigns={campaigns}
                  leads={leads}
                  customContacts={customContacts}
                  templates={templates}
                  workspaceConfig={workspaceConfig}
                  dataLoading={!dataLoaded && !hasResourceCache}
                  onNavigate={handleTabChange}
                  onGoToOnboarding={() => persistWorkspaceConfig(workspaceConfig, { completed: false })}
                  onConnectGoogle={signInWithGoogle}
                />
              } />
              <Route path="/campaigns" element={
                <CampaignsTab
                  campaigns={campaigns}
                  onCreate={createCampaignHandler}
                  onUpdate={updateCampaignHandler}
                  onDelete={deleteCampaignHandler}
                  templates={templates}
                  workspaceConfig={workspaceConfig}
                  isLoading={!dataLoaded && !hasResourceCache}
                />
              } />
              <Route path="/leads" element={
                <LeadDiscoveryTab
                  workspaceConfig={workspaceConfig}
                  onLeadSaved={refreshLeads}
                />
              } />
              <Route path="/contacts" element={
                <ContactsTab
                  leads={leads}
                  customContacts={customContacts}
                  templates={templates}
                  onUpdate={updateLeadHandler}
                  onDelete={deleteLeadHandler}
                  onCreateCustomContact={createCustomContactHandler}
                  onDeleteCustomContact={deleteCustomContactHandler}
                  workspaceConfig={workspaceConfig}
                  onNavigate={handleTabChange}
                  isLoading={!dataLoaded && !hasResourceCache}
                />
              } />
              <Route path="/drafts" element={<DraftsTab onNavigate={handleTabChange} workspaceConfig={workspaceConfig} />} />
              <Route path="/templates" element={
                <TemplatesTab
                  templates={templates}
                  onCreate={createTemplateHandler}
                  onUpdate={updateTemplateHandler}
                  onDelete={deleteTemplateHandler}
                  workspaceConfig={workspaceConfig}
                />
              } />
              <Route path="/settings" element={
                <SettingsPage
                  workspaceConfig={workspaceConfig}
                  onSaveWorkspaceConfig={updateWorkspaceConfig}
                  templates={templates}
                  onGoToOnboarding={() => persistWorkspaceConfig(workspaceConfig, { completed: false })}
                  onConnectGoogle={signInWithGoogle}
                  onNavigate={handleTabChange}
                />
              } />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          <footer className="mt-auto py-6 text-center text-xs text-muted">Made by Cornell Generative AI</footer>
        </div>
      </main>
    </div>
  )
}

export default function App() {

  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
