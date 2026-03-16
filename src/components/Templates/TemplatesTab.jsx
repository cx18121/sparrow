import React, { useState, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { v4 as uuidv4 } from 'uuid'
import {
  Plus, Trash2, Bold, Italic, UnderlineIcon, Link as LinkIcon,
  List, ListOrdered, Eye, Edit3, Users, Lock, Search, Copy,
} from 'lucide-react'
import Badge from '../ui/Badge'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import { sampleContactData } from '../../lib/mockData'

const VARIABLES = ['{{first_name}}', '{{last_name}}', '{{company}}', '{{role}}', '{{sender_name}}']

function fillVariables(html, data) {
  if (!html) return ''
  return html
    .replace(/\{\{first_name\}\}/g, data.first_name || 'Alex')
    .replace(/\{\{last_name\}\}/g, data.last_name || 'Chen')
    .replace(/\{\{company\}\}/g, data.company || 'Momentum AI')
    .replace(/\{\{role\}\}/g, data.role || 'CEO')
    .replace(/\{\{sender_name\}\}/g, data.sender_name || 'Your Name')
}

function ToolbarButton({ onClick, active, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      title={title}
      className={`p-1.5 rounded transition-colors ${active ? 'bg-primary/10 text-primary' : 'text-muted hover:text-dark hover:bg-gray-100'}`}
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
    <div className="border border-gray-200 rounded-lg overflow-hidden tiptap-editor">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 bg-gray-50/60 flex-wrap">
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
              className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded font-mono hover:bg-primary/20 transition-colors"
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

export default function TemplatesTab({ templates, setTemplates }) {
  const [search, setSearch] = useState('')
  const [filterShared, setFilterShared] = useState('all') // 'all' | 'shared' | 'personal'
  const [selectedId, setSelectedId] = useState(templates[0]?.id || null)
  const [view, setView] = useState('edit') // 'edit' | 'preview'
  const [editModal, setEditModal] = useState(false)
  const [form, setForm] = useState({ name: '', subject: '', body: '', isShared: false })
  const [editingId, setEditingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [previewData] = useState(sampleContactData)

  const filtered = templates.filter(t => {
    const matchSearch = t.name.toLowerCase().includes(search.toLowerCase()) || t.subject.toLowerCase().includes(search.toLowerCase())
    const matchShared = filterShared === 'all' || (filterShared === 'shared' ? t.isShared : !t.isShared)
    return matchSearch && matchShared
  })

  const selected = templates.find(t => t.id === selectedId)

  const openCreate = () => {
    setEditingId(null)
    setForm({ name: '', subject: '', body: '', isShared: false })
    setEditModal(true)
  }

  const openEdit = (t) => {
    setEditingId(t.id)
    setForm({ name: t.name, subject: t.subject, body: t.body, isShared: t.isShared })
    setEditModal(true)
  }

  const save = () => {
    const now = new Date().toISOString()
    if (editingId) {
      setTemplates(prev => prev.map(t => t.id === editingId ? { ...t, ...form, updatedAt: now } : t))
    } else {
      const id = uuidv4()
      setTemplates(prev => [...prev, { id, ...form, createdAt: now, updatedAt: now }])
      setSelectedId(id)
    }
    setEditModal(false)
  }

  const duplicate = (t) => {
    const now = new Date().toISOString()
    const id = uuidv4()
    setTemplates(prev => [...prev, { ...t, id, name: `${t.name} (copy)`, createdAt: now, updatedAt: now }])
    setSelectedId(id)
  }

  return (
    <div className="flex h-[calc(100vh-112px)] animate-fade-in">
      {/* Template list sidebar */}
      <div className="w-72 border-r border-gray-100 bg-white flex flex-col">
        <div className="p-3 border-b border-gray-100 space-y-2">
          <button onClick={openCreate} className="btn-primary w-full justify-center text-xs py-2">
            <Plus size={13} /> New template
          </button>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="input pl-7 text-xs py-1.5" />
          </div>
          <div className="flex gap-1">
            {[['all', 'All'], ['shared', 'Shared'], ['personal', 'Personal']].map(([v, l]) => (
              <button key={v} onClick={() => setFilterShared(v)} className={`flex-1 text-xs py-1 rounded-lg font-medium transition-colors ${filterShared === v ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-gray-100'}`}>{l}</button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {filtered.map(t => (
            <button
              key={t.id}
              onClick={() => { setSelectedId(t.id); setView('edit') }}
              className={`w-full text-left px-4 py-3 transition-colors group ${selectedId === t.id ? 'bg-primary/5 border-r-2 border-primary' : 'hover:bg-gray-50'}`}
            >
              <div className="flex items-center justify-between">
                <p className={`text-sm font-medium truncate ${selectedId === t.id ? 'text-primary' : 'text-dark'}`}>{t.name}</p>
                {t.isShared ? <Users size={11} className="text-muted shrink-0" /> : <Lock size={11} className="text-muted shrink-0" />}
              </div>
              <p className="text-xs text-muted mt-0.5 truncate">{t.subject || 'No subject'}</p>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted text-center py-8 px-4">No templates match.</p>
          )}
        </div>
      </div>

      {/* Editor / Preview area */}
      <div className="flex-1 overflow-y-auto bg-surface">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-muted text-sm">
            Select or create a template
          </div>
        ) : (
          <div className="p-6 max-w-3xl mx-auto">
            {/* Template header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-display font-semibold text-dark">{selected.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={selected.isShared ? 'shared' : 'personal'}>
                    {selected.isShared ? <><Users size={10} className="mr-1" />Shared</> : <><Lock size={10} className="mr-1" />Personal</>}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setView(v => v === 'edit' ? 'preview' : 'edit')}
                  className={`btn-secondary text-xs py-1.5 ${view === 'preview' ? 'text-primary border-primary/30 bg-primary/5' : ''}`}
                >
                  {view === 'edit' ? <><Eye size={13} /> Preview</> : <><Edit3 size={13} /> Edit</>}
                </button>
                <button onClick={() => duplicate(selected)} className="btn-ghost text-xs py-1.5"><Copy size={13} /></button>
                <button onClick={() => openEdit(selected)} className="btn-secondary text-xs py-1.5"><Edit3 size={13} /> Edit info</button>
                <button onClick={() => setDeleteTarget(selected.id)} className="btn-ghost text-xs py-1.5 hover:text-red-500"><Trash2 size={13} /></button>
              </div>
            </div>

            {view === 'edit' ? (
              <div className="card p-5 space-y-4">
                <div>
                  <label className="label">Subject line</label>
                  <input
                    value={selected.subject}
                    onChange={e => setTemplates(prev => prev.map(t => t.id === selected.id ? { ...t, subject: e.target.value } : t))}
                    placeholder="e.g. Quick question about {{company}}"
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Body</label>
                  <RichEditor
                    content={selected.body}
                    onChange={body => setTemplates(prev => prev.map(t => t.id === selected.id ? { ...t, body, updatedAt: new Date().toISOString() } : t))}
                    placeholder="Write your email here… Use the variable buttons above to insert dynamic fields."
                  />
                </div>
              </div>
            ) : (
              <div className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
                  <p className="text-xs text-muted mb-0.5">Preview (sample data)</p>
                  <p className="text-sm font-medium text-dark">{fillVariables(selected.subject, previewData)}</p>
                </div>
                <div
                  className="p-5 text-sm text-dark prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: fillVariables(selected.body, previewData) }}
                />
                <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 text-xs text-muted">
                  Preview uses: first_name="{previewData.first_name}", company="{previewData.company}", role="{previewData.role}"
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create/Edit info modal */}
      <Modal open={editModal} onClose={() => setEditModal(false)} title={editingId ? 'Edit template info' : 'New template'} size="sm">
        <div className="px-6 py-4 space-y-3">
          <div><label className="label">Template name *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Cold Intro — Startup Founder" className="input" /></div>
          <div><label className="label">Subject line</label><input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="e.g. Quick question about {{company}}" className="input" /></div>
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={form.isShared} onChange={e => setForm(f => ({ ...f, isShared: e.target.checked }))} className="sr-only peer" />
              <div className="w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
            </label>
            <span className="text-sm text-dark">Share with team</span>
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
        onConfirm={() => {
          setTemplates(prev => prev.filter(t => t.id !== deleteTarget))
          setSelectedId(templates.find(t => t.id !== deleteTarget)?.id || null)
          setDeleteTarget(null)
        }}
        title="Delete template"
        message="Delete this template? Any campaigns using it will need to be updated."
      />
    </div>
  )
}
