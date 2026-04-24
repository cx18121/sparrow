import React, { useEffect, useState } from 'react'
import {
  Plus, Trash2, Copy, Eye, EyeOff, Check, Mail, AlertCircle,
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

function SmtpSection() {
  const [form, setForm] = useState({ host: '', port: '587', username: '', password: '', tls: true })
  const [saved, setSaved] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const f = (k, v) => setForm(x => ({ ...x, [k]: v }))

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000) }

  return (
    <Section title="SMTP Configuration">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="label">Host</label>
          <input value={form.host} onChange={e => f('host', e.target.value)} placeholder="smtp.gmail.com" className="input" />
        </div>
        <div>
          <label className="label">Port</label>
          <input value={form.port} onChange={e => f('port', e.target.value)} placeholder="587" className="input" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Username / Email</label>
          <input value={form.username} onChange={e => f('username', e.target.value)} placeholder="you@example.com" className="input" />
        </div>
        <div>
          <label className="label">Password</label>
          <div className="relative">
            <input type={showPass ? 'text' : 'password'} value={form.password} onChange={e => f('password', e.target.value)} placeholder="App password" className="input pr-9" />
            <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-dark">
              {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </div>
      </div>
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={form.tls} onChange={e => f('tls', e.target.checked)} className="w-4 h-4 rounded accent-primary" />
        <span className="text-sm text-dark">Enable TLS / STARTTLS</span>
      </label>
      <div className="flex justify-end">
        <button onClick={save} className="btn-primary">
          {saved ? <><Check size={14} /> Saved!</> : 'Save SMTP settings'}
        </button>
      </div>
    </Section>
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
      <div className="flex items-start gap-2 p-3 bg-primary/5 rounded-lg border border-primary/10">
        <AlertCircle size={14} className="text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-primary">
          {connectedCount} provider key{connectedCount !== 1 ? 's' : ''} connected. These values come from onboarding and can be updated here.
        </p>
      </div>

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

function ApiKeysSection() {
  const [keys, setKeys] = useState([
    { id: uuidv4(), name: 'Production', key: `cf_live_${uuidv4().replace(/-/g, '').slice(0, 32)}`, createdAt: new Date().toISOString(), lastUsed: new Date().toISOString() },
  ])
  const [newName, setNewName] = useState('')
  const [revealed, setRevealed] = useState({})
  const [copied, setCopied] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const generate = () => {
    if (!newName.trim()) return
    setKeys(prev => [...prev, {
      id: uuidv4(), name: newName.trim(),
      key: `cf_live_${uuidv4().replace(/-/g, '').slice(0, 32)}`,
      createdAt: new Date().toISOString(), lastUsed: null,
    }])
    setNewName('')
  }

  const copy = (key, id) => {
    navigator.clipboard.writeText(key)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <Section title="Public API Keys">
      <div className="flex gap-2">
        <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && generate()} placeholder="Key name (e.g. Production)" className="input flex-1" />
        <button onClick={generate} disabled={!newName.trim()} className="btn-primary whitespace-nowrap"><Plus size={14} /> Generate key</button>
      </div>
      {keys.length === 0 ? (
        <p className="text-sm text-muted text-center py-4">No API keys yet.</p>
      ) : (
        <div className="space-y-2">
          {keys.map(k => (
            <div key={k.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-dark">{k.name}</p>
                <p className="text-xs font-mono text-muted mt-0.5 truncate">
                  {revealed[k.id] ? k.key : k.key.slice(0, 12) + '••••••••••••••••••••••••'}
                </p>
              </div>
              <button onClick={() => setRevealed(r => ({ ...r, [k.id]: !r[k.id] }))} className="btn-ghost px-2 py-1 text-xs">
                {revealed[k.id] ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button onClick={() => copy(k.key, k.id)} className="btn-ghost px-2 py-1 text-xs">
                {copied === k.id ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
              </button>
              <button onClick={() => setDeleteTarget(k.id)} className="btn-ghost px-2 py-1 text-xs hover:text-red-500">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { setKeys(prev => prev.filter(k => k.id !== deleteTarget)); setDeleteTarget(null) }}
        title="Revoke API key"
        message="Revoking this key will immediately disable any integrations using it. This cannot be undone."
      />
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
      <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
        <AlertCircle size={14} className="text-amber-600 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-700">Stay within your ESP's limits. Most providers recommend a delay of 30–60 seconds and a daily cap of 200–500 for new accounts.</p>
      </div>
      <div className="flex justify-end">
        <button onClick={save} className="btn-primary">
          {saved ? <><Check size={14} /> Saved!</> : 'Save limits'}
        </button>
      </div>
    </Section>
  )
}

const WEBHOOK_EVENTS = ['email.sent', 'email.opened', 'email.replied', 'email.bounced', 'campaign.completed']

function WebhooksSection() {
  const [webhooks, setWebhooks] = useState([])
  const [form, setForm] = useState({ url: '', events: [] })
  const [addOpen, setAddOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const toggleEvent = (e) => setForm(f => ({
    ...f,
    events: f.events.includes(e) ? f.events.filter(x => x !== e) : [...f.events, e],
  }))

  const add = () => {
    if (!form.url || form.events.length === 0) return
    setWebhooks(prev => [...prev, { id: uuidv4(), ...form, createdAt: new Date().toISOString() }])
    setForm({ url: '', events: [] })
    setAddOpen(false)
  }

  return (
    <Section title="Webhooks">
      <button onClick={() => setAddOpen(!addOpen)} className="btn-secondary text-xs py-1.5"><Plus size={13} /> Add webhook endpoint</button>

      {addOpen && (
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-3">
          <div>
            <label className="label">Endpoint URL</label>
            <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://your-app.com/webhook" className="input" />
          </div>
          <div>
            <label className="label">Events</label>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map(ev => (
                <label key={ev} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={form.events.includes(ev)} onChange={() => toggleEvent(ev)} className="w-3.5 h-3.5 rounded accent-primary" />
                  <span className="text-xs text-dark font-mono">{ev}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAddOpen(false)} className="btn-secondary text-xs">Cancel</button>
            <button onClick={add} disabled={!form.url || form.events.length === 0} className="btn-primary text-xs">Add endpoint</button>
          </div>
        </div>
      )}

      {webhooks.length === 0 && !addOpen && (
        <p className="text-sm text-muted text-center py-4">No webhooks configured.</p>
      )}

      {webhooks.map(w => (
        <div key={w.id} className="flex items-start justify-between p-3 bg-white border border-gray-100 rounded-xl">
          <div>
            <p className="text-sm font-mono text-dark truncate max-w-xs">{w.url}</p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {w.events.map(ev => <span key={ev} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">{ev}</span>)}
            </div>
          </div>
          <button onClick={() => setDeleteTarget(w.id)} className="btn-ghost px-2 py-1 hover:text-red-500"><Trash2 size={13} /></button>
        </div>
      ))}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { setWebhooks(prev => prev.filter(w => w.id !== deleteTarget)); setDeleteTarget(null) }}
        title="Remove webhook"
        message="Remove this endpoint? No further events will be delivered to it."
      />
    </Section>
  )
}

export default function SettingsPage({ workspaceConfig, onSaveWorkspaceConfig, templates, onGoToOnboarding }) {
  return (
    <div className="w-full max-w-5xl px-8 pb-10 pt-6 space-y-8">
      {onGoToOnboarding && (
        <div className="flex justify-end">
          <button onClick={onGoToOnboarding} className="btn-secondary flex items-center gap-2 text-xs">
            Go back to Onboarding <Sparkles size={13} className="text-primary" />
          </button>
        </div>
      )}
      <WorkspaceProfileSection workspaceConfig={workspaceConfig} onSave={onSaveWorkspaceConfig} templates={templates} />
      <ProviderKeysSection workspaceConfig={workspaceConfig} onSave={onSaveWorkspaceConfig} />
      <SmtpSection />
      <ApiKeysSection />
      <TeamSection />
      <SendingLimitsSection />
      <WebhooksSection />
    </div>
  )
}
