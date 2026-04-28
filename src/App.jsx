import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Search, Users, Mail, FileText, Settings as SettingsIcon, Inbox } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import AuthScreen from './components/Auth/AuthScreen'
import Sidebar from './components/Layout/Sidebar'
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

const formatTemplateBody = (body) => {
  if (!body) return ''
  if (body.includes('<')) return body

  return body
    .split(/\n{2,}/)
    .map(block => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function AppShell() {
  const { user, loading, signOut } = useAuth()
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
        previousOnboardingKeyRef.current = null
      }
      setWorkspaceConfig(createWorkspaceConfig({ user: null, templates }))
      setOnboardingState({ loaded: true, completed: false, data: null })
      return
    }

    const storageKey = getOnboardingStorageKey(user)
    const sessionKey = storageKey ? `${storageKey}_session` : null
    const stored = storageKey ? localStorage.getItem(storageKey) : null
    const completedThisSession = sessionKey ? sessionStorage.getItem(sessionKey) === 'true' : false
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
    const localCompleted = parsed?.completed || completedThisSession
    setWorkspaceConfig(localConfig)
    setOnboardingState({ loaded: true, completed: localCompleted, data: localConfig })

    let cancelled = false
    fetchProfile()
      .then((res) => {
        if (cancelled || !res?.profile) return
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
          completed: parsed?.completed === false ? false : !!res.profile.onboardingCompleted || localCompleted,
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
      setDataLoaded(false)
      return
    }

    let cancelled = false
    Promise.all([
      fetchTemplates().catch(e => { console.error('fetchTemplates failed:', e.message); return { items: [] } }),
      fetchCampaigns().catch(e => { console.error('fetchCampaigns failed:', e.message); return { items: [] } }),
      fetchLeads().catch(e => { console.error('fetchLeads failed:', e.message); return { items: [] } }),
      fetchCustomContacts().catch(e => { console.error('fetchCustomContacts failed:', e.message); return { items: [] } }),
    ]).then(([t, c, l, cc]) => {
      if (cancelled) return
      setTemplates(t?.items || [])
      setCampaigns((c?.items || []).map(campaignToUi))
      setLeads(l?.items || [])
      setCustomContacts(cc?.items || [])
      setDataLoaded(true)
    })

    return () => { cancelled = true }
  }, [user])

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

  const persistWorkspaceConfig = (data, {
    completed = onboardingState.completed,
    completeSession = false,
    templatesOverride = templates,
  } = {}) => {
    if (!user) return

    const normalized = createWorkspaceConfig({ user, templates: templatesOverride, data })
    const storageKey = getOnboardingStorageKey(user)
    const sessionKey = storageKey ? `${storageKey}_session` : null
    let completedAt = null

    if (storageKey) {
      try {
        completedAt = JSON.parse(localStorage.getItem(storageKey) || '{}')?.completedAt || null
      } catch {
        completedAt = null
      }
    }

    const next = {
      completed,
      completedAt: completed ? (completedAt || new Date().toISOString()) : completedAt,
      data: normalized,
    }

    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next))
    if (sessionKey && completeSession) sessionStorage.setItem(sessionKey, 'true')

    setWorkspaceConfig(normalized)
    setOnboardingState({ loaded: true, completed, data: normalized })

    // Mirror to /api/profile so changes survive across devices.
    // The Claude key is stripped from the cached config and sent
    // separately so /api/profile can encrypt it before insertion.
    const claudeKey = normalized.apiKeys?.claude || null
    const sanitizedConfig = {
      ...normalized,
      apiKeys: {}, // never persist any API keys in the workspace_config column
    }

    saveProfile({
      workspaceConfig: sanitizedConfig,
      defaultFilters: { leadsPerGeneration: normalized.leadsPerGeneration },
      resumePath: normalized.resumePath || null,
      resumeText: normalized.resumeText || null,
      ...(claudeKey ? { claudeApiKey: claudeKey } : {}),
      onboardingCompleted: completed,
    }).catch((err) => {
      console.error('Failed to persist workspace config', err)
    })
  }

  const saveOnboardingDraft = useCallback((data, templatesOverride = templates) => {
    if (!user) return

    const normalized = createWorkspaceConfig({ user, templates: templatesOverride, data })
    const storageKey = getOnboardingStorageKey(user)
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
      data: normalized,
    }

    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next))

    setWorkspaceConfig(normalized)
    setOnboardingState(current => ({ ...current, loaded: true, data: normalized }))
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
    persistWorkspaceConfig(nextData, {
      completed: true,
      completeSession: true,
      templatesOverride,
    })
  }

  const updateWorkspaceConfig = (dataOrUpdater) => {
    const current = workspaceConfig || createWorkspaceConfig({ user, templates })
    const nextData = typeof dataOrUpdater === 'function' ? dataOrUpdater(current) : dataOrUpdater
    persistWorkspaceConfig(nextData)
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
              <Route path="/" element={<Navigate to="/campaigns" replace />} />
              <Route path="/campaigns" element={
                <CampaignsTab
                  campaigns={campaigns}
                  onCreate={createCampaignHandler}
                  onUpdate={updateCampaignHandler}
                  onDelete={deleteCampaignHandler}
                  templates={templates}
                  workspaceConfig={workspaceConfig}
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
                  onNavigate={handleTabChange}
                />
              } />
              <Route path="*" element={<Navigate to="/campaigns" replace />} />
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
