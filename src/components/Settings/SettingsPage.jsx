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

function SetupReadinessPanel({ workspaceConfig, templates, onGoToOnboarding, onConnectGoogle, onNavigate }) {
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
      detail: hasGoogle ? 'Coldflow can ask Gmail to send from this account.' : 'Reconnect Google so Coldflow can send Gmail drafts.',
      done: hasGoogle,
      action: onConnectGoogle ? { label: 'Reconnect', onClick: onConnectGoogle } : null,
    },
    {
      label: 'Claude key added',
      detail: hasClaude ? 'Coldflow can generate drafts.' : 'Add a Claude key before generating drafts.',
      done: hasClaude,
    },
    {
      label: 'Background added',
      detail: hasResume ? 'Drafts can use your experience and offer.' : 'Add a resume, bio, offer, or positioning note.',
      done: hasResume,
    },
    {
      label: 'Sender set',
      detail: hasSender ? `${workspaceConfig.senderName} will appear in drafts.` : 'Set the name that should appear in drafts.',
      done: hasSender,
    },
    {
      label: 'Template selected',
      detail: hasTemplate ? 'Drafts have a starting structure.' : 'Create a reusable starting template.',
      done: hasTemplate,
      action: onNavigate ? { label: 'Templates', onClick: () => onNavigate('templates') } : null,
    },
  ]

  const completeCount = items.filter(item => item.done).length
  const ready = completeCount === items.length

  return (
    <div className="border-b border-slate-100 pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Setup readiness</p>
          <h2 className="mt-1 text-lg font-semibold text-dark">
            {ready ? 'Ready' : `${completeCount} of ${items.length} complete`}
          </h2>
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

      <div className="mt-4 divide-y divide-slate-100">
        {items.map(item => {
          const Icon = item.done ? CheckCircle2 : Circle
          return (
            <div key={item.label} className="flex items-start gap-3 py-3">
              <Icon size={15} className={`mt-0.5 shrink-0 ${item.done ? 'text-emerald-600' : 'text-slate-300'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-dark">{item.label}</p>
                <p className="mt-0.5 text-xs leading-5 text-muted">{item.detail}</p>
              </div>
              {item.action && !item.done && (
                <button type="button" onClick={item.action.onClick} className="shrink-0 text-xs font-semibold text-primary hover:underline">
                  {item.action.label}
                </button>
              )}
              </div>
          )
        })}
      </div>
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

  const save = async () => {
    const ok = await onSave(current => ({ ...current, ...form }))
    if (!ok) return
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Section title="Drafting Profile">
      <div>
        <label className="label">Background</label>
        <textarea
          value={form.resumeText}
          onChange={e => field('resumeText', e.target.value)}
          placeholder="Paste relevant experience, positioning, wins, and offer."
          className="input min-h-[140px] resize-y"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Uploaded resume or bio</label>
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
          <label className="label">Default lead batch size</label>
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
          <label className="label">Organization</label>
          <div className="relative">
            <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={form.senderCompany} onChange={e => field('senderCompany', e.target.value)} placeholder="Cornell Generative AI" className="input pl-8" />
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
          {saved ? <><Check size={14} /> Saved</> : 'Save drafting profile'}
        </button>
      </div>
    </Section>
  )
}

function ProviderKeysSection({ workspaceConfig, onSave }) {
  const [form, setForm] = useState({ claude: workspaceConfig.apiKeys?.claude || '' })
  const [profileState, setProfileState] = useState({ loading: true, profile: null, error: null })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setForm({ claude: workspaceConfig.apiKeys?.claude || '' })
  }, [workspaceConfig])

  useEffect(() => {
    let cancelled = false
    setProfileState(current => ({ ...current, loading: true, error: null }))
    fetchProfile()
      .then(res => {
        if (!cancelled) setProfileState({ loading: false, profile: res?.profile || null, error: null })
      })
      .catch(err => {
        if (!cancelled) setProfileState({ loading: false, profile: null, error: err.message || 'Could not load saved keys' })
      })
    return () => { cancelled = true }
  }, [])

  const save = async () => {
    const ok = await onSave(current => ({
      ...current,
      apiKeys: {
        ...current.apiKeys,
        ...form,
      },
    }))
    if (!ok) return
    if (form.claude) {
      setProfileState(current => ({
        ...current,
        profile: { ...(current.profile || {}), hasClaudeKey: true },
      }))
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const hasSavedClaude = !!profileState.profile?.hasClaudeKey
  const connectedCount = Object.values(form).filter(Boolean).length + (hasSavedClaude && !form.claude ? 1 : 0)

  return (
    <Section title="Provider Keys">
      <p className="text-xs text-muted">
        {connectedCount} Claude key{connectedCount !== 1 ? 's' : ''} saved. Saved secret fields are left blank; enter a new value only to replace one.
      </p>
      {profileState.error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {profileState.error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Claude</label>
          <input
            type="password"
            value={form.claude}
            onChange={e => setForm(current => ({ ...current, claude: e.target.value }))}
            placeholder={hasSavedClaude ? 'Saved key on file' : 'Anthropic API key'}
            className="input"
          />
          {hasSavedClaude && !form.claude && (
            <p className="mt-1 text-xs text-emerald-700">Claude key is saved. Leave blank to keep it.</p>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={save} className="btn-primary">
          {saved ? <><Check size={14} /> Saved</> : 'Save provider keys'}
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

function SendingLimitsSection({ workspaceConfig, onSave }) {
  const [form, setForm] = useState(workspaceConfig.sendingLimits || { dailyMax: 200, delaySeconds: 30 })
  const [saved, setSaved] = useState(false)
  const f = (k, v) => setForm(x => ({ ...x, [k]: v }))

  useEffect(() => {
    setForm(workspaceConfig.sendingLimits || { dailyMax: 200, delaySeconds: 30 })
  }, [workspaceConfig])

  const save = async () => {
    const ok = await onSave(current => ({
      ...current,
      sendingLimits: {
        ...current.sendingLimits,
        ...form,
      },
    }))
    if (!ok) return
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

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
          {saved ? <><Check size={14} /> Saved</> : 'Save limits'}
        </button>
      </div>
    </Section>
  )
}

export default function SettingsPage({ workspaceConfig, onSaveWorkspaceConfig, templates, onGoToOnboarding, onConnectGoogle, onNavigate }) {
  const [toast, setToast] = useState(null)
  const saveWorkspace = async (updater, label = 'Settings saved') => {
    try {
      await onSaveWorkspaceConfig(updater)
      setToast({ type: 'success', title: label, message: 'Refresh setup readiness if the checklist does not update right away.' })
      return true
    } catch (err) {
      setToast({
        type: 'error',
        title: 'Settings could not be saved',
        message: err.message || 'Try again in a moment.',
      })
      return false
    }
  }

  return (
    <div className="w-full max-w-5xl space-y-6 px-4 pb-10 pt-5 sm:px-6 lg:px-8">
      <Toast toast={toast} onClose={() => setToast(null)} />
      {onGoToOnboarding && (
        <div className="flex justify-start">
          <button onClick={onGoToOnboarding} className="btn-secondary flex items-center gap-2 text-xs">
            Back to setup <Sparkles size={13} className="text-primary" />
          </button>
        </div>
      )}
      <SetupReadinessPanel
        workspaceConfig={workspaceConfig}
        templates={templates}
        onGoToOnboarding={onGoToOnboarding}
        onConnectGoogle={onConnectGoogle}
        onNavigate={onNavigate}
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
      <SendingLimitsSection
        workspaceConfig={workspaceConfig}
        onSave={(updater) => saveWorkspace(updater, 'Sending limits saved')}
      />
    </div>
  )
}
