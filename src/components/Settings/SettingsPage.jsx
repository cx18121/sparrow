import React, { useState } from 'react'
import {
  Server, Key, Users, Clock, Webhook, Plus, Trash2,
  Copy, Eye, EyeOff, Check, Mail, Shield, AlertCircle,
} from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import Badge from '../ui/Badge'
import ConfirmDialog from '../ui/ConfirmDialog'

function Section({ icon: Icon, title, children }) {
  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon size={15} className="text-primary" />
        </div>
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
    <Section icon={Server} title="SMTP Configuration">
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
    <Section icon={Key} title="API Keys">
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
    <Section icon={Users} title="Team Members">
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
    <Section icon={Clock} title="Sending Limits">
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
    <Section icon={Webhook} title="Webhooks">
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

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div className="mb-2">
        <h1 className="text-xl font-display font-semibold text-dark">Settings</h1>
        <p className="text-sm text-muted mt-0.5">Configure your sending infrastructure, team, and integrations.</p>
      </div>
      <SmtpSection />
      <ApiKeysSection />
      <TeamSection />
      <SendingLimitsSection />
      <WebhooksSection />
    </div>
  )
}
