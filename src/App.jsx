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
  fetchSequences, createSequence, updateSequence, deleteSequence,
  fetchCampaigns, createCampaign, updateCampaign, deleteCampaign,
  fetchLeads, updateLead, deleteLead,
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
  const [sequences, setSequences] = useState([])
  const [leads, setLeads] = useState([])
  const [templates, setTemplates] = useState([])
  const [dataLoaded, setDataLoaded] = useState(false)

  const activeTab = TABS.find(t => location.pathname.startsWith(t.path))?.id || 'campaigns'

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
          data: res.profile.workspaceConfig || null,
        })
        setWorkspaceConfig(serverConfig)
        setOnboardingState({
          loaded: true,
          completed: !!res.profile.onboardingCompleted || localCompleted,
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
      setSequences([])
      setCampaigns([])
      setLeads([])
      setDataLoaded(false)
      return
    }

    let cancelled = false
    Promise.all([
      fetchTemplates().catch(e => { console.error('fetchTemplates failed:', e.message); return { items: [] } }),
      fetchSequences().catch(e => { console.error('fetchSequences failed:', e.message); return { items: [] } }),
      fetchCampaigns().catch(e => { console.error('fetchCampaigns failed:', e.message); return { items: [] } }),
      fetchLeads().catch(e => { console.error('fetchLeads failed:', e.message); return { items: [] } }),
    ]).then(([t, s, c, l]) => {
      if (cancelled) return
      const { userId, accessToken } = apiGetAuth()
      console.log('[data load] user:', user, '| userId:', userId, '| accessToken:', accessToken ? 'set' : 'null')
      console.log('[data load] templates:', t?.items?.length, '| sequences:', s?.items?.length, '| campaigns:', c?.items?.length, '| leads:', l?.items?.length)
      setTemplates(t?.items || [])
      setSequences(s?.items || [])
      setCampaigns((c?.items || []).map(campaignToUi))
      setLeads(l?.items || [])
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

  // ── Sequences ──
  const createSequenceHandler = async (data) => {
    const tempId = `temp-${Date.now()}`
    const optimistic = { ...data, id: tempId }
    setSequences(prev => [optimistic, ...prev])
    try {
      const created = await createSequence(data)
      setSequences(prev => prev.map(s => s.id === tempId ? created : s))
      return created
    } catch (err) {
      setSequences(prev => prev.filter(s => s.id !== tempId))
      throw err
    }
  }
  const updateSequenceHandler = async (data) => {
    const prev = sequences
    setSequences(curr => curr.map(s => s.id === data.id ? { ...s, ...data } : s))
    try {
      const updated = await updateSequence(data)
      setSequences(curr => curr.map(s => s.id === updated.id ? updated : s))
      return updated
    } catch (err) {
      setSequences(() => prev)
      throw err
    }
  }
  const deleteSequenceHandler = async (id) => {
    const prev = sequences
    setSequences(curr => curr.filter(s => s.id !== id))
    try {
      await deleteSequence(id)
    } catch (err) {
      setSequences(() => prev)
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
      apiKeys: { ...(normalized.apiKeys || {}), claude: '' },
    }

    saveProfile({
      workspaceConfig: sanitizedConfig,
      defaultFilters: { leadsPerGeneration: normalized.leadsPerGeneration },
      resumePath: normalized.resumePath || null,
      resumeText: normalized.resumeText || null,
      ...(claudeKey ? { claudeApiKey: claudeKey } : {}),
      ...(completed ? { onboardingCompleted: true } : {}),
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
      completed: previous?.completed || false,
      completedAt: previous?.completedAt || null,
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
    <div className="flex h-screen overflow-hidden bg-surface">
      <div className="dashboard-backdrop fixed inset-0" />
      <Sidebar
        activeTab={activeTab}
        tabs={TABS}
        onTabChange={handleTabChange}
      />

      <main className="relative z-10 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex h-14 items-center border-b-2 border-slate-100 bg-white/80 px-8 backdrop-blur-xl">
          <h1 className="font-display text-xl font-semibold tracking-[-0.03em] text-dark">
            {TABS.find(t => t.id === activeTab)?.label ?? 'Dashboard'}
          </h1>
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
                  sequences={sequences} templates={templates}
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
                  templates={templates}
                  onUpdate={updateLeadHandler}
                  onDelete={deleteLeadHandler}
                  workspaceConfig={workspaceConfig}
                />
              } />
              <Route path="/drafts" element={<DraftsTab />} />
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
