import React, { useState } from 'react'
import { Plus, Edit2, Pause, Play, Copy, Trash2, Search, Calendar } from 'lucide-react'
import { format } from 'date-fns'
import Badge from '../ui/Badge'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'

const INITIAL_FORM = {
  name: '', subject: '', status: 'draft',
  templateId: '', sequenceId: '', scheduledAt: '',
}

export default function CampaignsTab({ campaigns, onCreate, onUpdate, onDelete, sequences, templates, workspaceConfig }) {
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(INITIAL_FORM)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [saving, setSaving] = useState(false)
  const [pendingActions, setPendingActions] = useState(new Set())
  const workspaceTemplate = templates.find(template => template.id === workspaceConfig?.templateId)

  const getInitialForm = () => {
    return {
      ...INITIAL_FORM,
      templateId: workspaceTemplate?.id || '',
      subject: workspaceTemplate?.subject || '',
    }
  }

  const filtered = campaigns.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.subject.toLowerCase().includes(search.toLowerCase())
  )
  const activeCampaignCount = campaigns.filter(c => c.status === 'active').length
  const scheduledCount = campaigns.filter(c => Boolean(c.scheduledAt)).length
  const draftCount = campaigns.filter(c => c.status === 'draft').length

  const openCreate = () => {
    setEditing(null)
    setForm(getInitialForm())
    setModalOpen(true)
  }

  const openEdit = (c) => {
    setEditing(c.id)
    setForm({
      name: c.name, subject: c.subject || '', status: c.status,
      templateId: c.templateId || '', sequenceId: c.sequenceId || '',
      scheduledAt: c.scheduledAt ? c.scheduledAt.slice(0, 16) : '',
    })
    setModalOpen(true)
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    const payload = {
      name: form.name,
      subject: form.subject || null,
      status: form.status,
      templateId: form.templateId || null,
      sequenceId: form.sequenceId || null,
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
    }
    try {
      if (editing) {
        await onUpdate({ id: editing, ...payload })
      } else {
        await onCreate(payload)
      }
      setModalOpen(false)
    } catch (err) {
      console.error('Failed to save campaign', err)
    } finally {
      setSaving(false)
    }
  }

  const withPending = (id, fn) => {
    if (pendingActions.has(id)) return
    setPendingActions(prev => new Set([...prev, id]))
    fn().finally(() => setPendingActions(prev => { const n = new Set(prev); n.delete(id); return n }))
  }

  const toggleStatus = (c) => {
    if (pendingActions.has(c.id)) return
    const next = c.status === 'active' ? 'paused' : 'active'
    withPending(c.id, () => onUpdate({ id: c.id, status: next }).catch(err => console.error('Failed to toggle campaign', err)))
  }

  const duplicate = (c) => {
    if (pendingActions.has(c.id)) return
    withPending(c.id, () => onCreate({
      name: `${c.name} (copy)`,
      subject: c.subject || null,
      status: 'draft',
      templateId: c.templateId || null,
      sequenceId: c.sequenceId || null,
      scheduledAt: c.scheduledAt || null,
    }).catch(err => console.error('Failed to duplicate campaign', err)))
  }

  const remove = (id) => {
    if (pendingActions.has(id)) return
    withPending(id, () => onDelete(id).catch(err => console.error('Failed to delete campaign', err)))
  }

  const field = (key, value) => setForm(f => ({ ...f, [key]: value }))

  return (
    <div className="page-shell">
      <section className="page-toolbar">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 items-center gap-3">
            <div className="relative w-full max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search campaigns…"
                className="input pl-9"
              />
            </div>
            <button onClick={openCreate} className="btn-primary shrink-0">
              <Plus size={15} /> New campaign
            </button>
          </div>
          <p className="text-sm text-muted shrink-0">
            {search ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''}` : `${campaigns.length} campaign${campaigns.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </section>

      <section className="table-shell">
        {filtered.length === 0 ? (
          <div className="empty-state border-0 bg-transparent shadow-none">
            {search ? 'No campaigns match your search.' : 'No campaigns yet. Create your first one!'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-[rgba(248,250,252,0.86)]">
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Name</th>
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Subject</th>
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Status</th>
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Scheduled</th>
                <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(c => (
                <tr key={c.id} className="transition-colors hover:bg-[rgba(248,250,252,0.72)]">
                  <td className="px-5 py-4 font-medium text-dark">{c.name}</td>
                  <td className="max-w-[260px] px-5 py-4 text-muted truncate">{c.subject || '—'}</td>
                  <td className="px-5 py-4">
                    <Badge variant={c.status}>{c.status}</Badge>
                  </td>
                  <td className="px-5 py-4 text-muted">
                    {c.scheduledAt ? (
                      <span className="flex items-center gap-1">
                        <Calendar size={12} />
                        {format(new Date(c.scheduledAt), 'MMM d, h:mm a')}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => openEdit(c)} disabled={pendingActions.has(c.id)} className="btn-ghost px-2 py-1 disabled:opacity-40">
                        <Edit2 size={13} />
                      </button>
                      {(c.status === 'active' || c.status === 'paused') && (
                        <button onClick={() => toggleStatus(c)} disabled={pendingActions.has(c.id)} className="btn-ghost px-2 py-1 disabled:opacity-40">
                          {c.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
                        </button>
                      )}
                      <button onClick={() => duplicate(c)} disabled={pendingActions.has(c.id)} className="btn-ghost px-2 py-1 disabled:opacity-40">
                        <Copy size={13} />
                      </button>
                      <button onClick={() => setDeleteTarget(c.id)} disabled={pendingActions.has(c.id)} className="btn-ghost px-2 py-1 hover:text-red-500 disabled:opacity-40">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Create / Edit modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit campaign' : 'New campaign'} size="md">
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="label">Campaign name *</label>
            <input value={form.name} onChange={e => field('name', e.target.value)} placeholder="e.g. YC W24 Founders Outreach" className="input" required />
          </div>
          <div>
            <label className="label">Subject line</label>
            <input value={form.subject} onChange={e => field('subject', e.target.value)} placeholder="e.g. Quick question about {{company}}" className="input" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Linked template</label>
              <select value={form.templateId} onChange={e => field('templateId', e.target.value)} className="select">
                <option value="">Select template…</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Linked sequence</label>
              <select value={form.sequenceId} onChange={e => field('sequenceId', e.target.value)} className="select">
                <option value="">Select sequence…</option>
                {sequences.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Status</label>
              <select value={form.status} onChange={e => field('status', e.target.value)} className="select">
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="label">Schedule (optional)</label>
              <input
                type="datetime-local"
                value={form.scheduledAt}
                onChange={e => field('scheduledAt', e.target.value)}
                className="input"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={save} disabled={saving || !form.name} className="btn-primary">
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create campaign'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => remove(deleteTarget)}
        title="Delete campaign"
        message="Are you sure you want to delete this campaign? This action cannot be undone."
      />
    </div>
  )
}
