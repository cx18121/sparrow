import React, { useEffect, useState } from 'react'
import {
  Plus, Trash2, Check, Mail, AlertCircle,
  Building2, Briefcase, Target, Sparkles,
} from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import Badge from '../ui/Badge'
import ConfirmDialog from '../ui/ConfirmDialog'

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

      <div className="grid grid-cols-2 gap-3">
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

      <div className="grid grid-cols-3 gap-3">
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

      <div className="grid grid-cols-2 gap-3">
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
        <div className="col-span-2">
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
      <div className="grid grid-cols-2 gap-6">
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

export default function SettingsPage({ workspaceConfig, onSaveWorkspaceConfig, templates, onGoToOnboarding }) {
  return (
    <div className="w-full max-w-3xl px-8 pb-10 pt-6 space-y-8">
      {onGoToOnboarding && (
        <div className="flex justify-start">
          <button onClick={onGoToOnboarding} className="btn-secondary flex items-center gap-2 text-xs">
            Go back to Onboarding <Sparkles size={13} className="text-primary" />
          </button>
        </div>
      )}
      <WorkspaceProfileSection workspaceConfig={workspaceConfig} onSave={onSaveWorkspaceConfig} templates={templates} />
      <ProviderKeysSection workspaceConfig={workspaceConfig} onSave={onSaveWorkspaceConfig} />
      <SendingLimitsSection />
    </div>
  )
}
