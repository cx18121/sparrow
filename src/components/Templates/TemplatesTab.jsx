import React, { useState, useEffect, useMemo, useRef } from 'react'
import DOMPurify from 'dompurify'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Plus, Trash2, Bold, Italic, UnderlineIcon, Link as LinkIcon,
  List, ListOrdered, Eye, Edit3, Search, Copy, Save,
} from 'lucide-react'
import Badge from '../ui/Badge'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import { sampleContactData } from '../../lib/mockData'

const VARIABLES = ['{{first_name}}', '{{last_name}}', '{{company}}', '{{role}}', '{{sender_name}}']
const SUBJECT_VARIABLES = ['{{first_name}}', '{{company}}']

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
        active ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-white hover:text-dark'
      }`}
    >
      {children}
    </button>
  )
}

function RichEditor({ content, onChange, placeholder = 'Write your email…' }) {
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

  const setLink = () => {
    const url = window.prompt('URL:')
    if (!url) return
    editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  if (!editor) return null

  return (
    <div className="tiptap-editor overflow-hidden rounded-[28px] border border-white/80 bg-white/82 shadow-card backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-[rgba(248,250,252,0.82)] px-3 py-2">
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
          <Bold size={13} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
          <Italic size={13} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
          <UnderlineIcon size={13} />
        </ToolbarButton>
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
          <List size={13} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
          <ListOrdered size={13} />
        </ToolbarButton>
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <ToolbarButton onClick={setLink} active={editor.isActive('link')} title="Add link">
          <LinkIcon size={13} />
        </ToolbarButton>
        <div className="w-px h-4 bg-gray-200 mx-1 ml-auto" />
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
  const [view, setView] = useState('edit') // 'edit' | 'preview'
  const [editModal, setEditModal] = useState(false)
  const [form, setForm] = useState({ name: '', subject: '', body: '' })
  const [editingId, setEditingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [saved, setSaved] = useState(false)
  // Local draft state for the inline editor — we debounce writes so that
  // subject/body keystrokes don't fire a PATCH per character.
  const [draft, setDraft] = useState({ id: null, subject: '', body: '' })
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
    if (!selectedId || !templates.some(template => template.id === selectedId)) {
      setSelectedId(defaultTemplateId)
    }
  }, [defaultTemplateId, selectedId, templates])

  // Sync draft with the selected template when the selection changes.
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

  const flushDraft = (override) => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    const next = override || draftRef.current
    if (!next.id) return
    const selectedTpl = templates.find(t => t.id === next.id)
    if (!selectedTpl) return
    if (selectedTpl.subject === next.subject && selectedTpl.body === next.body) return
    onUpdate({ id: next.id, subject: next.subject, body: next.body })
      .then(() => {
        const latest = draftRef.current
        if (latest.id === next.id && latest.subject === next.subject && latest.body === next.body) {
          draftDirtyRef.current = false
        }
      })
      .catch(err => {
        console.error('Failed to save template', err)
      })
  }

  const scheduleFlush = (next) => {
    draftDirtyRef.current = true
    setDraft(next)
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
    flushTimerRef.current = setTimeout(() => flushDraft(next), 500)
  }

  const filtered = templates.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) || (t.subject || '').toLowerCase().includes(search.toLowerCase())
  )

  const selected = templates.find(t => t.id === selectedId)
  const defaultTemplate = templates.find(template => template.id === workspaceConfig?.templateId) || null

  const openCreate = () => {
    setEditingId(null)
    setForm({ name: '', subject: '', body: '' })
    setEditModal(true)
  }

  const openEdit = (t) => {
    setEditingId(t.id)
    setForm({ name: t.name, subject: t.subject, body: t.body })
    setEditModal(true)
  }

  const save = async () => {
    if (editingId) {
      await onUpdate({ id: editingId, name: form.name, subject: form.subject, body: form.body })
    } else {
      const created = await onCreate({
        name: form.name,
        subject: form.subject || '(no subject)',
        body: form.body || '<p></p>',
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
      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)] xl:items-start">
        <aside className="flex h-fit flex-col gap-4 xl:sticky xl:top-6">
          <button onClick={openCreate} className="btn-primary w-full justify-center text-xs">
            <Plus size={13} /> New template
          </button>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates…" className="input pl-9 text-sm" />
          </div>

          <div className="max-h-[calc(100vh-340px)] space-y-2 overflow-y-auto pr-1">
            {filtered.map(t => (
              <button
                key={t.id}
                onClick={() => { setSelectedId(t.id); setView('edit') }}
                className={`w-full rounded-[24px] border px-4 py-3 text-left transition-all duration-150 ${
                  selectedId === t.id
                    ? 'border-primary/15 bg-primary/5 shadow-[0_16px_32px_rgba(27,110,243,0.08)]'
                    : 'border-white/70 bg-white/70 hover:-translate-y-0.5 hover:bg-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <p className={`truncate text-sm font-medium ${selectedId === t.id ? 'text-primary' : 'text-dark'}`}>{t.name}</p>
                </div>
                <p className="mt-1 truncate text-xs text-muted">{t.subject || 'No subject yet'}</p>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="empty-state border-0 bg-transparent px-4 py-10 text-xs shadow-none">No templates match.</div>
            )}
          </div>
        </aside>

        <section className="space-y-4">
          {!selected ? (
            <div className="empty-state">Select or create a template to start editing.</div>
          ) : (
            <>
              <div className="page-toolbar">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="font-display text-2xl font-semibold tracking-[-0.04em] text-dark">{selected.name}</h2>
                    {workspaceConfig?.templateId === selected.id && (
                    <div className="mt-2">
                      <Badge variant="draft">Default template</Badge>
                    </div>
                  )}
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
                      Toggle between editing and previewing to validate tone, variables, and sample-data substitution before this template ships.
                    </p>
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
                    {view === 'edit' && (
                      <button
                        onClick={() => { flushDraft(); setSaved(true); setTimeout(() => setSaved(false), 2000) }}
                        className={`btn-secondary text-xs ${saved ? 'text-green-600' : ''}`}
                      >
                        {saved ? <>Saved ✓</> : <><Save size={13} /> Save</>}
                      </button>
                    )}
                    <button onClick={() => duplicate(selected)} className="btn-secondary text-xs"><Copy size={13} /> Duplicate</button>
                    <button onClick={() => openEdit(selected)} className="btn-secondary text-xs"><Edit3 size={13} /> Edit info</button>
                    <button onClick={() => setDeleteTarget(selected.id)} className="btn-ghost text-xs hover:text-red-500"><Trash2 size={13} /> Delete</button>
                  </div>
                </div>
              </div>

              {view === 'edit' ? (
                <div className="card p-6 space-y-5">
                  <div>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <label className="label mb-0">Subject line</label>
                      <p className="text-xs text-muted">
                        Use <span className="font-mono text-primary">{'{{company}}'}</span> to insert the company name.
                      </p>
                    </div>
                    <input
                      value={draft.id === selected.id ? draft.subject : (selected.subject || '')}
                      onChange={e => scheduleFlush({ ...draft, id: selected.id, subject: e.target.value })}
                      onBlur={() => flushDraft()}
                      placeholder="e.g. Quick question about {{company}}"
                      className="input"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span>Subject variables:</span>
                      {SUBJECT_VARIABLES.map(variable => (
                        <button
                          key={variable}
                          type="button"
                          onClick={() => scheduleFlush({
                            ...draft,
                            id: selected.id,
                            subject: `${draft.id === selected.id ? draft.subject : (selected.subject || '')}${variable}`,
                          })}
                          className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
                        >
                          {variable}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="label">Body</label>
                    <RichEditor
                      key={selected.id}
                      content={selected.body}
                      onChange={body => scheduleFlush({ ...draft, id: selected.id, body })}
                      placeholder="Write your email here… Use the variable buttons above to insert dynamic fields."
                    />
                  </div>
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <div className="border-b border-slate-100 bg-[rgba(248,250,252,0.82)] px-6 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted/80">Preview</p>
                    <p className="mt-2 text-sm font-medium text-dark">{fillVariables(draft.id === selected.id ? draft.subject : selected.subject, previewData)}</p>
                  </div>
                  <div
                    className="prose prose-sm max-w-none p-6 text-dark"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(fillVariables(draft.id === selected.id ? draft.body : selected.body, previewData)) }}
                  />
                  <div className="border-t border-slate-100 bg-[rgba(248,250,252,0.82)] px-6 py-4 text-xs text-muted">
                    Preview uses: first_name="{previewData.first_name}", company="{previewData.company}", role="{previewData.role}"
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Create/Edit info modal */}
      <Modal open={editModal} onClose={() => setEditModal(false)} title={editingId ? 'Edit template info' : 'New template'} size="sm">
        <div className="px-6 py-4 space-y-3">
          <div><label className="label">Template name *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Cold Intro — Startup Founder" className="input" /></div>
          <div>
            <label className="label">Subject line</label>
            <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="e.g. Quick question about {{company}}" className="input" />
            <p className="mt-2 text-xs text-muted">
              Use <span className="font-mono text-primary">{'{{company}}'}</span> for the company name, for example: Quick question about <span className="font-mono text-primary">{'{{company}}'}</span>
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setEditModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={save} disabled={!form.name} className="btn-primary">{editingId ? 'Save' : 'Create template'}</button>
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
            console.error('Failed to delete template', err)
          }
        }}
        title="Delete template"
        message="Delete this template? Any campaigns using it will need to be updated."
      />
    </div>
  )
}
