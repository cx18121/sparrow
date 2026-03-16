import React, { useState } from 'react'
import { Plus, Edit2, Pause, Play, Copy, Trash2, Search, Calendar } from 'lucide-react'
import { format } from 'date-fns'
import { v4 as uuidv4 } from 'uuid'
import Badge from '../ui/Badge'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'

const INITIAL_FORM = {
  name: '', subject: '', status: 'draft',
  templateId: '', sequenceId: '', contactListId: '', scheduledAt: '',
}

export default function CampaignsTab({ campaigns, setCampaigns, sequences, templates }) {
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(INITIAL_FORM)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const filtered = campaigns.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.subject.toLowerCase().includes(search.toLowerCase())
  )

  const openCreate = () => {
    setEditing(null)
    setForm(INITIAL_FORM)
    setModalOpen(true)
  }

  const openEdit = (c) => {
    setEditing(c.id)
    setForm({
      name: c.name, subject: c.subject, status: c.status,
      templateId: c.templateId || '', sequenceId: c.sequenceId || '',
      contactListId: c.contactListId || '',
      scheduledAt: c.scheduledAt ? c.scheduledAt.slice(0, 16) : '',
    })
    setModalOpen(true)
  }

  const save = () => {
    const now = new Date().toISOString()
    if (editing) {
      setCampaigns(prev => prev.map(c =>
        c.id === editing ? { ...c, ...form, scheduledAt: form.scheduledAt || null, updatedAt: now } : c
      ))
    } else {
      setCampaigns(prev => [...prev, {
        id: uuidv4(), ...form,
        scheduledAt: form.scheduledAt || null,
        createdAt: now, updatedAt: now,
      }])
    }
    setModalOpen(false)
  }

  const toggleStatus = (c) => {
    const next = c.status === 'active' ? 'paused' : 'active'
    setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, status: next } : x))
  }

  const duplicate = (c) => {
    const now = new Date().toISOString()
    setCampaigns(prev => [...prev, { ...c, id: uuidv4(), name: `${c.name} (copy)`, status: 'draft', createdAt: now, updatedAt: now }])
  }

  const remove = (id) => setCampaigns(prev => prev.filter(c => c.id !== id))

  const field = (key, value) => setForm(f => ({ ...f, [key]: value }))

  return (
    <div className="p-6 animate-fade-in">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-display font-semibold text-dark">Campaigns</h1>
          <p className="text-sm text-muted mt-0.5">{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus size={15} /> New campaign
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search campaigns…"
          className="input pl-8"
        />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-muted text-sm">
            {search ? 'No campaigns match your search.' : 'No campaigns yet. Create your first one!'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted">Subject</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted">Scheduled</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-dark">{c.name}</td>
                  <td className="px-4 py-3 text-muted max-w-[240px] truncate">{c.subject || '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={c.status}>{c.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {c.scheduledAt ? (
                      <span className="flex items-center gap-1">
                        <Calendar size={12} />
                        {format(new Date(c.scheduledAt), 'MMM d, h:mm a')}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(c)} className="btn-ghost px-2 py-1">
                        <Edit2 size={13} />
                      </button>
                      {(c.status === 'active' || c.status === 'paused') && (
                        <button onClick={() => toggleStatus(c)} className="btn-ghost px-2 py-1">
                          {c.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
                        </button>
                      )}
                      <button onClick={() => duplicate(c)} className="btn-ghost px-2 py-1">
                        <Copy size={13} />
                      </button>
                      <button onClick={() => setDeleteTarget(c.id)} className="btn-ghost px-2 py-1 hover:text-red-500">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
            <button onClick={save} disabled={!form.name} className="btn-primary">
              {editing ? 'Save changes' : 'Create campaign'}
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
