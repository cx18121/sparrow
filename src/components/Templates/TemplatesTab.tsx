import React, { useState, useEffect, useMemo, useRef } from 'react'
import DOMPurify from 'dompurify'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Plus, Trash2, Bold, Italic, UnderlineIcon, Link as LinkIcon,
  List, ListOrdered, Eye, Edit3, Search, Copy, Save, Loader2, Check, X,
} from 'lucide-react'
import Badge from '../ui/Badge'
import EmptyState from '../ui/EmptyState'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import Toast from '../ui/Toast'

const sampleContactData = { first_name: 'Alex', last_name: 'Chen', company: 'Momentum AI', role: 'Co-founder & CEO', sender_name: 'Your Name' }

const VARIABLES = ['{{first_name}}', '{{last_name}}', '{{company}}', '{{role}}', '{{sender_name}}']

function fillVariables(html, data) {
  if (!html) return ''
  return html
    .replace(/\{\{first_name\}\}/g, data.first_name || 'Alex')
    .replace(/\{\{firstName\}\}/g, data.first_name || 'Alex')
    .replace(/\{\{last_name\}\}/g, data.last_name || 'Chen')
    .replace(/\{\{company\}\}/g, data.company || 'Momentum AI')
    .replace(/\{\{company_name\}\}/g, data.company || 'Momentum AI')
    .replace(/\{\{companyName\}\}/g, data.company || 'Momentum AI')
    .replace(/\{\{role\}\}/g, data.role || 'CEO')
    .replace(/\{\{sender_name\}\}/g, data.sender_name || 'Your Name')
    .replace(/\{\{senderName\}\}/g, data.sender_name || 'Your Name')
}

function ToolbarButton({ onClick, active, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      title={title}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
        active ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-slate-100/70 hover:text-dark'
      }`}
    >
      {children}
    </button>
  )
}

function RichEditor({ content, onChange, placeholder = 'Write your email…' }) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const linkInputRef = useRef(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: 'focus:outline-none' },
    },
  })

  const insertVariable = (v) => {
    editor?.commands.insertContent(v)
  }

  const openLink = () => {
    const existing = editor?.getAttributes('link').href || ''
    setLinkUrl(existing)
    setLinkOpen(true)
    setTimeout(() => linkInputRef.current?.focus(), 0)
  }

  const applyLink = () => {
    if (linkUrl.trim()) {
      editor?.chain().focus().extendMarkRange('link').setLink({ href: linkUrl.trim() }).run()
    } else {
      editor?.chain().focus().extendMarkRange('link').unsetLink().run()
    }
    setLinkOpen(false)
    setLinkUrl('')
  }

  const cancelLink = () => {
    setLinkOpen(false)
    setLinkUrl('')
  }

  if (!editor) return null

  return (
    <div className="tiptap-editor overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50/80 px-3 py-2">
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
          <Bold size={13} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
          <Italic size={13} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
          <UnderlineIcon size={13} />
        </ToolbarButton>
        <div className="w-px h-4 bg-slate-100 mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
          <List size={13} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
          <ListOrdered size={13} />
        </ToolbarButton>
        <div className="w-px h-4 bg-slate-100 mx-1" />
        <ToolbarButton onClick={openLink} active={editor.isActive('link') || linkOpen} title="Add link">
          <LinkIcon size={13} />
        </ToolbarButton>
        <div className="w-px h-4 bg-slate-100 mx-1 ml-auto" />
        <div className="flex items-center gap-1">
          {VARIABLES.map(v => (
            <button
              key={v}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insertVariable(v) }}
              className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {linkOpen && (
        <div className="flex items-center gap-2 border-b border-slate-100 bg-white px-3 py-2">
          <LinkIcon size={12} className="shrink-0 text-muted" />
          <input
            ref={linkInputRef}
            type="url"
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink() }
              if (e.key === 'Escape') cancelLink()
            }}
            placeholder="https://..."
            className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-dark outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/15"
          />
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); applyLink() }}
            className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white transition-all hover:brightness-110"
          >
            Apply
          </button>
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); cancelLink() }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-slate-100 hover:text-dark"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <EditorContent editor={editor} />
    </div>
  )
}

export default function TemplatesTab({ templates, onCreate, onUpdate, onDelete, workspaceConfig }) {
  const [search, setSearch] = useState('')
  const defaultTemplateId = workspaceConfig?.templateId && templates.some(t => t.id === workspaceConfig.templateId)
    ? workspaceConfig.templateId
    : templates[0]?.id || null
  const [selectedId, setSelectedId] = useState(defaultTemplateId)
  const [view, setView] = useState('edit')
  const [editModal, setEditModal] = useState(false)
  const [form, setForm] = useState({ name: '', subject: '' })
  const [editingId, setEditingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [savingExplicit, setSavingExplicit] = useState(false)
  const [saved, setSaved] = useState(false)
  const [draft, setDraft] = useState({ id: null, subject: '', body: '' })
  const [toast, setToast] = useState(null)
  const flushTimerRef = useRef(null)
  const draftRef = useRef(draft)
  const draftDirtyRef = useRef(false)

  const previewData = useMemo(() => ({
    ...sampleContactData,
    sender_name: workspaceConfig?.senderName || sampleContactData.sender_name,
  }), [workspaceConfig?.senderName])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    if (!selectedId || !templates.some(t => t.id === selectedId)) {
      setSelectedId(defaultTemplateId)
    }
  }, [defaultTemplateId, selectedId, templates])

  useEffect(() => {
    const selectedTpl = templates.find(t => t.id === selectedId)
    if (!selectedTpl) {
      draftDirtyRef.current = false
      setDraft({ id: null, subject: '', body: '' })
      return
    }
    if (draftDirtyRef.current && draft.id === selectedTpl.id) return
    draftDirtyRef.current = false
    setDraft({ id: selectedTpl.id, subject: selectedTpl.subject || '', body: selectedTpl.body || '' })
  }, [draft.id, selectedId, templates])

  useEffect(() => () => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
  }, [])

  const flushDraft = (override = undefined) => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    const next = override || draftRef.current
    if (!next.id) return Promise.resolve()
    const selectedTpl = templates.find(t => t.id === next.id)
    if (!selectedTpl) return Promise.resolve()
    if (selectedTpl.subject === next.subject && selectedTpl.body === next.body) return Promise.resolve()
    return onUpdate({ id: next.id, subject: next.subject, body: next.body })
      .then(() => {
        const latest = draftRef.current
        if (latest.id === next.id && latest.subject === next.subject && latest.body === next.body) {
          draftDirtyRef.current = false
        }
      })
      .catch(err => {
        setToast({ type: 'error', title: 'Could not save template', message: err?.message || 'Please try again.' })
      })
  }

  const scheduleFlush = (next) => {
    draftDirtyRef.current = true
    setDraft(next)
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
    flushTimerRef.current = setTimeout(() => flushDraft(next), 500)
  }

  const saveExplicit = async () => {
    setSavingExplicit(true)
    try {
      await flushDraft()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSavingExplicit(false)
    }
  }

  const filtered = templates.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) || (t.subject || '').toLowerCase().includes(search.toLowerCase())
  )

  const selected = templates.find(t => t.id === selectedId)

  const openCreate = () => {
    setEditingId(null)
    setForm({ name: '', subject: '' })
    setEditModal(true)
  }

  const openRename = (t) => {
    setEditingId(t.id)
    setForm({ name: t.name, subject: '' })
    setEditModal(true)
  }

  const saveModal = async () => {
    if (editingId) {
      await onUpdate({ id: editingId, name: form.name })
    } else {
      const created = await onCreate({
        name: form.name,
        subject: form.subject || '(no subject)',
        body: '<p></p>',
      })
      if (created?.id) setSelectedId(created.id)
    }
    setEditModal(false)
  }

  const duplicate = async (t) => {
    const created = await onCreate({
      name: `${t.name} (copy)`,
      subject: t.subject,
      body: t.body,
      isShared: false,
    })
    if (created?.id) setSelectedId(created.id)
  }

  return (
    <div className="page-shell space-y-6">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)] xl:items-start">
        <aside className="flex h-fit flex-col gap-4 xl:sticky xl:top-6">
          <button onClick={openCreate} className="btn-primary w-full justify-center text-xs">
            <Plus size={13} /> New template
          </button>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates…" className="input pl-9 text-sm" />
          </div>

          <div className="space-y-2 overflow-y-auto pr-1 xl:max-h-[calc(100vh-180px)]">
            {filtered.map(t => (
              <button
                key={t.id}
                onClick={() => { setSelectedId(t.id); setView('edit') }}
                className={`w-full rounded-[24px] border px-4 py-3 text-left transition-all duration-150 ${
                  selectedId === t.id
                    ? 'border-primary/15 bg-primary/5 shadow-[0_16px_32px_rgba(27,110,243,0.08)]'
                    : 'border-slate-100 bg-white hover:-translate-y-0.5 hover:border-slate-200'
                }`}
              >
                <p className={`truncate text-sm font-medium ${selectedId === t.id ? 'text-primary' : 'text-dark'}`}>{t.name}</p>
                <p className="mt-1 truncate text-xs text-muted">{t.subject || 'No subject yet'}</p>
              </button>
            ))}
            {filtered.length === 0 && (
              <EmptyState>No templates match.</EmptyState>
            )}
          </div>
        </aside>

        <section className="space-y-4">
          {!selected ? (
            <EmptyState>Select or create a template to start editing.</EmptyState>
          ) : (
            <>
              <div className="page-toolbar">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="font-display text-2xl font-semibold tracking-[-0.04em] text-dark">{selected.name}</h2>
                    {workspaceConfig?.templateId === selected.id && (
                      <div className="mt-2">
                        <Badge variant="draft">Default template</Badge>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="segmented-control">
                      <button
                        type="button"
                        onClick={() => setView('edit')}
                        className={`segmented-chip ${view === 'edit' ? 'segmented-chip-active' : ''}`}
                      >
                        <span className="inline-flex items-center gap-1.5"><Edit3 size={13} /> Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setView('preview')}
                        className={`segmented-chip ${view === 'preview' ? 'segmented-chip-active' : ''}`}
                      >
                        <span className="inline-flex items-center gap-1.5"><Eye size={13} /> Preview</span>
                      </button>
                    </div>
                    <button
                      onClick={saveExplicit}
                      disabled={savingExplicit || view !== 'edit'}
                      className={`btn-primary text-xs ${view !== 'edit' ? 'invisible' : ''}`}
                    >
                      {savingExplicit
                        ? <><Loader2 size={13} className="animate-spin" /> Saving</>
                        : saved
                        ? <><Check size={13} /> Saved</>
                        : <><Save size={13} /> Save</>}
                    </button>
                    <button onClick={() => duplicate(selected)} className="btn-ghost text-xs">
                      <Copy size={13} /> Duplicate
                    </button>
                    <button onClick={() => openRename(selected)} className="btn-ghost text-xs">
                      <Edit3 size={13} /> Rename
                    </button>
                    <div className="h-4 w-px bg-slate-200 mx-1" />
                    <button onClick={() => setDeleteTarget(selected.id)} className="btn-ghost text-xs hover:text-red-500">
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>
              </div>

              {view === 'edit' ? (
                <div className="card p-6 space-y-5">
                  <div>
                    <label className="label">Subject line</label>
                    <input
                      value={draft.id === selected.id ? draft.subject : (selected.subject || '')}
                      onChange={e => scheduleFlush({ ...draft, id: selected.id, subject: e.target.value })}
                      onBlur={() => flushDraft()}
                      placeholder="e.g. Quick question about {{company}}"
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">Body</label>
                    <RichEditor
                      key={selected.id}
                      content={selected.body}
                      onChange={body => scheduleFlush({ ...draft, id: selected.id, body })}
                      placeholder="Write your email here… Use the variable buttons to insert recipient details."
                    />
                  </div>
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <div className="border-b border-slate-100 bg-slate-50/80 px-6 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Preview</p>
                    <p className="mt-2 text-sm font-medium text-dark">
                      {fillVariables(draft.id === selected.id ? draft.subject : selected.subject, previewData)}
                    </p>
                  </div>
                  <div
                    className="template-preview prose prose-sm max-w-none p-6 text-dark"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(fillVariables(draft.id === selected.id ? draft.body : selected.body, previewData)) }}
                  />
                  <div className="border-t border-slate-100 bg-slate-50/80 px-6 py-4 text-xs text-muted">
                    Previewing as: {previewData.first_name} {previewData.last_name}, {previewData.company} ({previewData.role})
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <Modal open={editModal} onClose={() => setEditModal(false)} title={editingId ? 'Rename template' : 'New template'} size="sm">
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="label">Template name *</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && form.name && saveModal()}
              placeholder="e.g. Cold Intro — Startup Founder"
              className="input"
              autoFocus
            />
          </div>
          {!editingId && (
            <div>
              <label className="label">Subject line</label>
              <input
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                placeholder="e.g. Quick question about {{company}}"
                className="input"
              />
              <p className="mt-2 text-xs text-muted">
                Use <span className="font-mono text-primary">{'{{company}}'}</span>, <span className="font-mono text-primary">{'{{first_name}}'}</span>, etc. to personalize. You can change this later.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setEditModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={saveModal} disabled={!form.name.trim()} className="btn-primary">
              {editingId ? 'Rename' : 'Create template'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          const victim = deleteTarget
          setDeleteTarget(null)
          try {
            await onDelete(victim)
            setSelectedId(templates.find(t => t.id !== victim)?.id || null)
          } catch (err) {
            setToast({ type: 'error', title: 'Could not delete template', message: err?.message || 'Please try again.' })
          }
        }}
        title="Delete template"
        message="Delete this template? Any campaigns using it will need to be updated."
      />
    </div>
  )
}
