import React, { useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { BarChart2, Layers, Users, Mail, FileText, Settings } from 'lucide-react'

import { AuthProvider, useAuth } from './contexts/AuthContext'
import Header from './components/Layout/Header'
import SignInModal from './components/Auth/SignInModal'
import CampaignsTab from './components/Campaigns/CampaignsTab'
import SequencesTab from './components/Sequences/SequencesTab'
import ContactsTab from './components/Contacts/ContactsTab'
import AnalyticsTab from './components/Analytics/AnalyticsTab'
import TemplatesTab from './components/Templates/TemplatesTab'
import SettingsPage from './components/Settings/SettingsPage'

import {
  seedCampaigns, seedSequences, seedContacts, seedTemplates,
} from './lib/mockData'

const TABS = [
  { id: 'campaigns', label: 'Campaigns', icon: Mail, path: '/campaigns' },
  { id: 'sequences', label: 'Sequences', icon: Layers, path: '/sequences' },
  { id: 'contacts', label: 'Contacts', icon: Users, path: '/contacts' },
  { id: 'analytics', label: 'Analytics', icon: BarChart2, path: '/analytics' },
  { id: 'templates', label: 'Templates', icon: FileText, path: '/templates' },
]

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const [signInOpen, setSignInOpen] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-surface">
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
          <Mail size={18} className="text-white" />
        </div>
        <h1 className="text-2xl font-display font-semibold text-dark">Welcome to ColdFlow</h1>
        <p className="text-muted text-sm">Sign in to access your dashboard.</p>
        <button onClick={() => setSignInOpen(true)} className="btn-primary">Sign in</button>
        <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
      </div>
    )
  }

  return children
}

function AppShell() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [signInOpen, setSignInOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (settingsOpen) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header
          onSignIn={() => setSignInOpen(true)}
          onOpenSettings={() => setSettingsOpen(false)}
          activeTab={activeTab}
          tabs={TABS}
          onTabChange={(id) => { setSettingsOpen(false); handleTabChange(id) }}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="flex items-center gap-2 px-6 py-3 bg-white border-b border-gray-100">
            <button onClick={() => setSettingsOpen(false)} className="text-xs text-muted hover:text-dark transition-colors">← Back</button>
            <span className="text-xs text-muted">/</span>
            <span className="text-xs text-dark font-medium">Settings</span>
          </div>
          <SettingsPage />
        </main>
        <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        onSignIn={() => setSignInOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        activeTab={activeTab}
        tabs={TABS}
        onTabChange={handleTabChange}
      />

      <main className="flex-1 overflow-y-auto">
        <ProtectedRoute>
          <Routes>
            <Route path="/" element={<Navigate to="/campaigns" replace />} />
            <Route path="/campaigns" element={
              <CampaignsTab
                campaigns={campaigns} setCampaigns={setCampaigns}
                sequences={sequences} templates={templates}
              />
            } />
            <Route path="/sequences" element={
              <SequencesTab
                sequences={sequences} setSequences={setSequences}
                templates={templates}
              />
            } />
            <Route path="/contacts" element={
              <ContactsTab contacts={contacts} setContacts={setContacts} />
            } />
            <Route path="/analytics" element={<AnalyticsTab />} />
            <Route path="/templates" element={
              <TemplatesTab templates={templates} setTemplates={setTemplates} />
            } />
            <Route path="*" element={<Navigate to="/campaigns" replace />} />
          </Routes>
        </ProtectedRoute>
      </main>

      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
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
