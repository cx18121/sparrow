import React, { useEffect, useState } from 'react'
import {
  Plus, Trash2, Check, Mail, AlertCircle,
  Building2, Briefcase, Target, Sparkles, CheckCircle2, Circle, RefreshCw,
} from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import Badge from '../ui/Badge'
import ConfirmDialog from '../ui/ConfirmDialog'
import Toast from '../ui/Toast'
import { fetchProfile } from '../../lib/api'

function Section({ title, children }) {
  return (
    <div className="space-y-4 py-4">
      <div className="pb-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-dark">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function SetupReadinessPanel({ workspaceConfig, templates, onGoToOnboarding, onNavigate, toast }) {
  const [profileState, setProfileState] = useState({ loading: true, profile: null, error: null })

  const loadProfile = () => {
    setProfileState(current => ({ ...current, loading: true, error: null }))
    fetchProfile()
      .then(res => setProfileState({ loading: false, profile: res?.profile || null, error: null }))
      .catch(err => setProfileState({ loading: false, profile: null, error: err.message || 'Could not load setup status' }))
  }

  useEffect(() => {
    loadProfile()
  }, [])

  const hasClaude = !!workspaceConfig?.apiKeys?.claude || !!profileState.profile?.hasClaudeKey
  const hasGoogle = !!profileState.profile?.hasGoogleRefreshToken
  const hasResume = !!workspaceConfig?.resumeText?.trim() || !!workspaceConfig?.resumeFileName || !!profileState.profile?.resumeText
  const hasSender = !!workspaceConfig?.senderName?.trim()
  const hasTemplate = !!workspaceConfig?.templateId || templates.length > 0

  const items = [
    {
      label: 'Google connected',
      detail: hasGoogle ? 'Gmail can request send access for this account.' : 'Sign in with Google again so the app can store Gmail send access.',
      done: hasGoogle,
      action: onGoToOnboarding ? { label: 'Reconnect', onClick: onGoToOnboarding } : null,
    },
    {
      label: 'Gmail API ready',
      detail: hasGoogle ? 'Confirm the Gmail API is enabled in the same Google Cloud project.' : 'Connect Google first, then enable Gmail API in Google Cloud.',
      done: hasGoogle,
      caution: hasGoogle,
    },
    {
      label: 'Claude key configured',
      detail: hasClaude ? 'Draft generation has model access.' : 'Add a Claude key so contacts can become drafts.',
      done: hasClaude,
    },
    {
      label: 'Resume or background added',
      detail: hasResume ? 'Generated copy has sender context.' : 'Add resume, bio, offer, or positioning context.',
      done: hasResume,
    },
    {
      label: 'Default sender set',
      detail: hasSender ? `${workspaceConfig.senderName} is the sender.` : 'Set the name that appears in generated outreach.',
      done: hasSender,
    },
    {
      label: 'Template path available',
      detail: hasTemplate ? 'Drafts can use a default or custom template.' : 'Create a reusable starting template.',
      done: hasTemplate,
      action: onNavigate ? { label: 'Templates', onClick: () => onNavigate('templates') } : null,
    },
  ]

  const completeCount = items.filter(item => item.done).length
  const ready = completeCount === items.length

  return (
    <div className="rounded-2xl border border-slate-100 bg-white/82 px-5 py-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Setup readiness</p>
          <h2 className="mt-1 font-display text-xl font-semibold text-dark">
            {ready ? 'Ready to send outreach' : `${completeCount} of ${items.length} setup checks complete`}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Keep this checklist green before relying on bulk send or generated drafts.
          </p>
        </div>
        <button
          type="button"
          onClick={loadProfile}
          disabled={profileState.loading}
          className="btn-ghost px-2 py-1 text-xs"
          title="Refresh setup status"
        >
          <RefreshCw size={13} className={profileState.loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {profileState.error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle size={13} /> {profileState.error}
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map(item => {
          const Icon = item.done ? CheckCircle2 : Circle
          return (
            <div key={item.label} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-3">
              <div className="flex items-start gap-2">
                <Icon size={15} className={`mt-0.5 shrink-0 ${item.done ? 'text-emerald-600' : 'text-slate-300'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-dark">{item.label}</p>
                    {item.caution && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">verify</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs leading-5 text-muted">{item.detail}</p>
                  {item.action && !item.done && (
                    <button type="button" onClick={item.action.onClick} className="mt-2 text-xs font-semibold text-primary hover:underline">
                      {item.action.label}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {toast && (
        <p className="mt-3 text-xs text-muted">
          Changes saved here may take a moment to reflect in setup status. Use Refresh after saving credentials.
        </p>
      )}
    </div>
  )
}

function WorkspaceProfileSection({ workspaceConfig, onSave, templates }) {
  const [form, setForm] = useState(workspaceConfig)
  const [saved, setSaved] = useState(false)
  const field = (key, value) => setForm(current => ({ ...current, [key]: value }))

  useEffect(() => {
    setForm(workspaceConfig)
  }, [workspaceConfig])

  const save = () => {
    onSave(current => ({ ...current, ...form }))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Section title="AI Workspace Profile">
      <div>
        <label className="label">Resume or background context</label>
        <textarea
          value={form.resumeText}
          onChange={e => field('resumeText', e.target.value)}
          placeholder="Paste your founder bio, positioning, wins, and offer."
          className="input min-h-[140px] resize-y"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Uploaded file</label>
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-dark hover:border-primary/40 hover:bg-primary/5 transition-colors">
            <span className="truncate">{form.resumeFileName || 'Upload resume file'}</span>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              className="hidden"
              onChange={e => field('resumeFileName', e.target.files?.[0]?.name || '')}
            />
          </label>
        </div>
        <div>
          <label className="label">Leads per generation</label>
          <div className="relative">
            <Target size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="number"
              min={1}
              max={1000}
              value={form.leadsPerGeneration}
              onChange={e => field('leadsPerGeneration', Math.max(1, Number(e.target.value) || 1))}
              className="input pl-8"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Sender name</label>
          <input value={form.senderName} onChange={e => field('senderName', e.target.value)} placeholder="Jordan Lee" className="input" />
        </div>
        <div>
          <label className="label">Company</label>
          <div className="relative">
            <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={form.senderCompany} onChange={e => field('senderCompany', e.target.value)} placeholder="ColdFlow" className="input pl-8" />
          </div>
        </div>
        <div>
          <label className="label">Role</label>
          <div className="relative">
            <Briefcase size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={form.senderRole} onChange={e => field('senderRole', e.target.value)} placeholder="Founder" className="input pl-8" />
          </div>
        </div>
      </div>

      <div>
        <label className="label">Default template</label>
        <select value={form.templateId} onChange={e => field('templateId', e.target.value)} className="select">
          {templates.map(template => (
            <option key={template.id} value={template.id}>{template.name}</option>
          ))}
        </select>
      </div>

      <div className="flex justify-end">
        <button onClick={save} className="btn-primary">
          {saved ? <><Check size={14} /> Saved!</> : 'Save workspace profile'}
        </button>
      </div>
    </Section>
  )
}

function ProviderKeysSection({ workspaceConfig, onSave }) {
  const [form, setForm] = useState(workspaceConfig.apiKeys)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setForm(workspaceConfig.apiKeys)
  }, [workspaceConfig])

  const save = () => {
    onSave(current => ({
      ...current,
      apiKeys: {
        ...current.apiKeys,
        ...form,
      },
    }))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const connectedCount = Object.values(form).filter(Boolean).length

  return (
    <Section title="Model & Data Providers">
      <p className="text-xs text-muted">
        {connectedCount} provider key{connectedCount !== 1 ? 's' : ''} connected. These values come from onboarding and can be updated here.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">OpenAI</label>
          <input type="password" value={form.openai} onChange={e => setForm(current => ({ ...current, openai: e.target.value }))} placeholder="sk-..." className="input" />
        </div>
        <div>
          <label className="label">Claude</label>
          <input type="password" value={form.claude} onChange={e => setForm(current => ({ ...current, claude: e.target.value }))} placeholder="Anthropic API key" className="input" />
        </div>
        <div>
          <label className="label">Gemini</label>
          <input type="password" value={form.gemini} onChange={e => setForm(current => ({ ...current, gemini: e.target.value }))} placeholder="Google AI Studio key" className="input" />
        </div>
        <div>
          <label className="label">Apollo</label>
          <input type="password" value={form.apollo} onChange={e => setForm(current => ({ ...current, apollo: e.target.value }))} placeholder="Lead source key" className="input" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Serper</label>
          <input type="password" value={form.serper} onChange={e => setForm(current => ({ ...current, serper: e.target.value }))} placeholder="Research API key" className="input" />
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={save} className="btn-primary">
          {saved ? <><Check size={14} /> Saved!</> : 'Save provider keys'}
        </button>
      </div>
    </Section>
  )
}

function TeamSection() {
  const [members, setMembers] = useState([
    { id: uuidv4(), email: 'you@example.com', role: 'admin', status: 'active' },
  ])
  const [invite, setInvite] = useState({ email: '', role: 'editor' })

  const sendInvite = () => {
    if (!invite.email.trim()) return
    setMembers(prev => [...prev, { id: uuidv4(), email: invite.email.trim(), role: invite.role, status: 'invited' }])
    setInvite({ email: '', role: 'editor' })
  }

  return (
    <Section title="Team Members">
      <div className="flex gap-2">
        <input
          type="email" value={invite.email} onChange={e => setInvite(i => ({ ...i, email: e.target.value }))}
          onKeyDown={e => e.key === 'Enter' && sendInvite()}
          placeholder="colleague@example.com" className="input flex-1"
        />
        <select value={invite.role} onChange={e => setInvite(i => ({ ...i, role: e.target.value }))} className="select w-32">
          <option value="admin">Admin</option>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <button onClick={sendInvite} disabled={!invite.email.trim()} className="btn-primary whitespace-nowrap">
          <Mail size={14} /> Invite
        </button>
      </div>
      <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 overflow-hidden">
        {members.map(m => (
          <div key={m.id} className="flex items-center justify-between px-4 py-3 bg-white">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-xs font-semibold">
                {m.email[0].toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-dark">{m.email}</p>
                {m.status === 'invited' && <p className="text-xs text-amber-600">Invitation pending</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={m.role}>{m.role}</Badge>
              {m.status !== 'active' || m.role !== 'admin' ? (
                <button onClick={() => setMembers(prev => prev.filter(x => x.id !== m.id))} className="btn-ghost px-2 py-1 hover:text-red-500">
                  <Trash2 size={12} />
                </button>
              ) : <div className="w-7" />}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function SendingLimitsSection() {
  const [form, setForm] = useState({ dailyMax: 200, delaySeconds: 30 })
  const [saved, setSaved] = useState(false)
  const f = (k, v) => setForm(x => ({ ...x, [k]: v }))
  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000) }

  return (
    <Section title="Sending Limits">
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
        <div>
          <label className="label">Daily send limit</label>
          <div className="relative">
            <input type="number" min={1} max={10000} value={form.dailyMax} onChange={e => f('dailyMax', parseInt(e.target.value) || 0)} className="input" />
          </div>
          <p className="text-xs text-muted mt-1">Maximum emails sent per day across all campaigns.</p>
        </div>
        <div>
          <label className="label">Delay between sends (seconds)</label>
          <input type="number" min={0} max={3600} value={form.delaySeconds} onChange={e => f('delaySeconds', parseInt(e.target.value) || 0)} className="input" />
          <p className="text-xs text-muted mt-1">Time to wait between individual sends to avoid throttling.</p>
        </div>
      </div>
      <div className="flex justify-end">
        <button onClick={save} className="btn-primary">
          {saved ? <><Check size={14} /> Saved!</> : 'Save limits'}
        </button>
      </div>
    </Section>
  )
}

export default function SettingsPage({ workspaceConfig, onSaveWorkspaceConfig, templates, onGoToOnboarding, onNavigate }) {
  const [toast, setToast] = useState(null)
  const saveWorkspace = (updater, label = 'Settings saved') => {
    onSaveWorkspaceConfig(updater)
    setToast({ type: 'success', title: label, message: 'Setup status will refresh after the profile sync completes.' })
  }

  return (
    <div className="w-full max-w-5xl space-y-6 px-4 pb-10 pt-5 sm:px-6 lg:px-8">
      <Toast toast={toast} onClose={() => setToast(null)} />
      {onGoToOnboarding && (
        <div className="flex justify-start">
          <button onClick={onGoToOnboarding} className="btn-secondary flex items-center gap-2 text-xs">
            Go back to Onboarding <Sparkles size={13} className="text-primary" />
          </button>
        </div>
      )}
      <SetupReadinessPanel
        workspaceConfig={workspaceConfig}
        templates={templates}
        onGoToOnboarding={onGoToOnboarding}
        onNavigate={onNavigate}
        toast={toast}
      />
      <WorkspaceProfileSection
        workspaceConfig={workspaceConfig}
        onSave={(updater) => saveWorkspace(updater, 'Workspace profile saved')}
        templates={templates}
      />
      <ProviderKeysSection
        workspaceConfig={workspaceConfig}
        onSave={(updater) => saveWorkspace(updater, 'Provider keys saved')}
      />
      <SendingLimitsSection />
    </div>
  )
}
