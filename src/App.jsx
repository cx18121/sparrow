import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { BarChart2, Layers, Users, Mail, FileText } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'

import { AuthProvider, useAuth } from './contexts/AuthContext'
import AuthScreen from './components/Auth/AuthScreen'
import Sidebar from './components/Layout/Sidebar'
import CampaignsTab from './components/Campaigns/CampaignsTab'
import SequencesTab from './components/Sequences/SequencesTab'
import ContactsTab from './components/Contacts/ContactsTab'
import AnalyticsTab from './components/Analytics/AnalyticsTab'
import TemplatesTab from './components/Templates/TemplatesTab'
import SettingsPage from './components/Settings/SettingsPage'
import OnboardingScreen from './components/Onboarding/OnboardingScreen'

import {
  seedCampaigns, seedSequences, seedContacts, seedTemplates,
} from './lib/mockData'
import { createWorkspaceConfig } from './lib/workspaceConfig'

const TABS = [
  { id: 'campaigns', label: 'Campaigns', icon: Mail, path: '/campaigns' },
  { id: 'sequences', label: 'Sequences', icon: Layers, path: '/sequences' },
  { id: 'contacts', label: 'Contacts', icon: Users, path: '/contacts' },
  { id: 'analytics', label: 'Analytics', icon: BarChart2, path: '/analytics' },
  { id: 'templates', label: 'Templates', icon: FileText, path: '/templates' },
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

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [onboardingState, setOnboardingState] = useState({ loaded: false, completed: false, data: null })
  const [workspaceConfig, setWorkspaceConfig] = useState(() => createWorkspaceConfig({ user: null, templates: seedTemplates }))

  // Shared state (would be Supabase-backed in production)
  const [campaigns, setCampaigns] = useState(seedCampaigns)
  const [sequences, setSequences] = useState(seedSequences)
  const [contacts, setContacts] = useState(seedContacts)
  const [templates, setTemplates] = useState(seedTemplates)

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

    const nextWorkspaceConfig = createWorkspaceConfig({ user, templates, data: parsed?.data || null })

    previousOnboardingKeyRef.current = storageKey
    setWorkspaceConfig(nextWorkspaceConfig)

    if (!stored) {
      setOnboardingState({ loaded: true, completed: completedThisSession, data: nextWorkspaceConfig })
      return
    }

    setOnboardingState({
      loaded: true,
      completed: completedThisSession,
      data: nextWorkspaceConfig,
    })
  }, [user, templates])

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

  const syncOnboardingTemplate = (data) => {
    if (data.templateMode !== 'custom') {
      return { data, templatesOverride: templates }
    }

    const customTemplate = data.customTemplate || {}
    const hasRequiredFields = customTemplate.name?.trim() && customTemplate.subject?.trim() && customTemplate.body?.trim()

    if (!hasRequiredFields) {
      return { data: { ...data, templateMode: 'existing' }, templatesOverride: templates }
    }

    const templateId = customTemplate.id || uuidv4()
    const now = new Date().toISOString()
    const nextTemplate = {
      id: templateId,
      name: customTemplate.name.trim(),
      subject: customTemplate.subject.trim(),
      body: formatTemplateBody(customTemplate.body.trim()),
      isShared: false,
      createdAt: customTemplate.id
        ? templates.find(template => template.id === templateId)?.createdAt || now
        : now,
      updatedAt: now,
    }

    const templateExists = templates.some(template => template.id === templateId)
    const nextTemplates = templateExists
      ? templates.map(template => template.id === templateId ? { ...template, ...nextTemplate } : template)
      : [...templates, nextTemplate]

    setTemplates(nextTemplates)

    return {
      templatesOverride: nextTemplates,
      data: {
        ...data,
        templateId,
        customTemplate: nextTemplate,
      },
    }
  }

  const completeOnboarding = (data) => {
    const { data: nextData, templatesOverride } = syncOnboardingTemplate(data)
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
        onOpenSettings={() => setSettingsOpen(current => !current)}
        activeTab={activeTab}
        tabs={TABS}
        onTabChange={(id) => { setSettingsOpen(false); handleTabChange(id) }}
        settingsOpen={settingsOpen}
      />

      <main className="relative z-10 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex h-14 items-center border-b-2 border-slate-100 bg-white/80 px-8 backdrop-blur-xl">
          <h1 className="font-display text-xl font-semibold tracking-[-0.03em] text-dark">
            {settingsOpen ? 'Settings' : TABS.find(t => t.id === activeTab)?.label ?? 'Dashboard'}
          </h1>
        </div>
        <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
          {settingsOpen ? (
            <SettingsPage
              workspaceConfig={workspaceConfig}
              onSaveWorkspaceConfig={updateWorkspaceConfig}
              templates={templates}
            />
          ) : (
            <Routes>
              <Route path="/" element={<Navigate to="/campaigns" replace />} />
              <Route path="/campaigns" element={
                <CampaignsTab
                  campaigns={campaigns} setCampaigns={setCampaigns}
                  sequences={sequences} templates={templates}
                  workspaceConfig={workspaceConfig}
                />
              } />
              <Route path="/sequences" element={
                <SequencesTab
                  sequences={sequences} setSequences={setSequences}
                  templates={templates}
                  workspaceConfig={workspaceConfig}
                />
              } />
              <Route path="/contacts" element={
                <ContactsTab
                  contacts={contacts}
                  setContacts={setContacts}
                  workspaceConfig={workspaceConfig}
                />
              } />
              <Route path="/analytics" element={<AnalyticsTab />} />
              <Route path="/templates" element={
                <TemplatesTab
                  templates={templates}
                  setTemplates={setTemplates}
                  workspaceConfig={workspaceConfig}
                />
              } />
              <Route path="*" element={<Navigate to="/campaigns" replace />} />
            </Routes>
          )}
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
