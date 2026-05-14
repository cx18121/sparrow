import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useAppData } from '../../contexts/AppDataContext'
import DOMPurify from 'dompurify'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Plus, Trash2, Bold, Italic, UnderlineIcon, Link as LinkIcon,
  List, ListOrdered, Eye, Edit3, Search, Copy, Loader2, Check, X, Library, MoreHorizontal,
  Paperclip, FileText,
} from 'lucide-react'
import Badge from '../ui/Badge'
import EmptyState from '../ui/EmptyState'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import { useToast } from '../../contexts/ToastContext'
import { defaultAttachmentIds, getAttachmentLibrary, sanitizeAttachmentIds } from '../../lib/attachments'
import { PREVIEW_SAMPLE } from '../../lib/previewSample'

const VARIABLES = ['{{first_name}}', '{{last_name}}', '{{company}}', '{{role}}', '{{sender_name}}', '{{feature_line}}', '{{fit_angle}}']

function fillVariables(html, data) {
  if (!html) return ''
  return html
    .replace(/\{\{first_name\}\}/g, data.first_name || PREVIEW_SAMPLE.first_name)
    .replace(/\{\{firstName\}\}/g, data.first_name || PREVIEW_SAMPLE.first_name)
    .replace(/\{\{last_name\}\}/g, data.last_name || PREVIEW_SAMPLE.last_name)
    .replace(/\{\{company\}\}/g, data.company || PREVIEW_SAMPLE.company)
    .replace(/\{\{company_name\}\}/g, data.company || PREVIEW_SAMPLE.company)
    .replace(/\{\{companyName\}\}/g, data.company || PREVIEW_SAMPLE.company)
    .replace(/\{\{role\}\}/g, data.role || PREVIEW_SAMPLE.role)
    .replace(/\{\{sender_name\}\}/g, data.sender_name || PREVIEW_SAMPLE.sender_name)
    .replace(/\{\{senderName\}\}/g, data.sender_name || PREVIEW_SAMPLE.sender_name)
    .replace(/\{\{feature_line\}\}/g, data.feature_line || PREVIEW_SAMPLE.feature_line)
    .replace(/\{\{featureLine\}\}/g, data.feature_line || PREVIEW_SAMPLE.feature_line)
    .replace(/\{\{fit_angle\}\}/g, data.fit_angle || PREVIEW_SAMPLE.fit_angle)
    .replace(/\{\{fitAngle\}\}/g, data.fit_angle || PREVIEW_SAMPLE.fit_angle)
}

function normalizeSafeLinkUrl(value) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') return candidate
  } catch {
    return ''
  }
  return ''
}

function ToolbarButton({ onClick, active, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      title={title}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
        active ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-warm-100 hover:text-dark'
      }`}
    >
      {children}
    </button>
  )
}

function RichEditor({ content, onChange, placeholder = 'Write your email…', ariaLabel = 'Email body' }) {
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
      attributes: { class: 'focus:outline-none', role: 'textbox', 'aria-label': ariaLabel },
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
    const safeUrl = normalizeSafeLinkUrl(linkUrl)
    if (safeUrl) {
      editor?.chain().focus().extendMarkRange('link').setLink({ href: safeUrl }).run()
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
    <div className="tiptap-editor overflow-hidden rounded-2xl border border-warm-200 bg-panel">
      <div className="flex flex-wrap items-center gap-1 border-b border-warm-200 bg-warm-50/80 px-3 py-2">
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
          <Bold size={13} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
          <Italic size={13} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
          <UnderlineIcon size={13} />
        </ToolbarButton>
        <div className="w-px h-4 bg-warm-200 mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
          <List size={13} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
          <ListOrdered size={13} />
        </ToolbarButton>
        <div className="w-px h-4 bg-warm-200 mx-1" />
        <ToolbarButton onClick={openLink} active={editor.isActive('link') || linkOpen} title="Add link">
          <LinkIcon size={13} />
        </ToolbarButton>
        <div className="w-px h-4 bg-warm-200 mx-1 ml-auto" />
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
        <div className="flex items-center gap-2 border-b border-warm-200 bg-warm-50 px-3 py-2">
          <LinkIcon size={12} className="shrink-0 text-muted" />
          <input
            ref={linkInputRef}
            type="url"
            aria-label="Link URL"
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink() }
              if (e.key === 'Escape') cancelLink()
            }}
            placeholder="https://..."
            className="flex-1 rounded-xl border border-warm-200 px-3 py-1.5 text-xs text-dark outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/15"
          />
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); applyLink() }}
            className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-warm-50 transition-all hover:brightness-110"
          >
            Apply
          </button>
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); cancelLink() }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-warm-100 hover:text-dark"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <EditorContent editor={editor} />
    </div>
  )
}

const isLibraryTemplate = (t) => t.userId === '__library__'

export default function TemplatesTab({ workspaceConfig }) {
  const { templates, createTemplate: onCreate, updateTemplate: onUpdate, deleteTemplate: onDelete } = useAppData()
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
  const [saved, setSaved] = useState(false)
  const [draft, setDraft] = useState({ id: null, subject: '', body: '' })
  const { showToast } = useToast()
  const [moreOpen, setMoreOpen] = useState(false)
  const flushTimerRef = useRef(null)
  const draftRef = useRef(draft)
  const draftDirtyRef = useRef(false)
  const moreRef = useRef(null)

  const previewData = useMemo(() => ({
    ...PREVIEW_SAMPLE,
    sender_name: workspaceConfig?.senderName || PREVIEW_SAMPLE.sender_name,
  }), [workspaceConfig?.senderName])
  const attachmentLibrary = useMemo(() => getAttachmentLibrary(workspaceConfig), [workspaceConfig])

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

  useEffect(() => {
    const handler = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
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
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
      })
      .catch(err => {
        showToast({ type: 'error', title: 'Could not save template', message: err?.message || 'Please try again.' })
      })
  }

  const scheduleFlush = (next) => {
    draftDirtyRef.current = true
    setDraft(next)
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
    flushTimerRef.current = setTimeout(() => flushDraft(next), 500)
  }

  const allFiltered = templates.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) || (t.subject || '').toLowerCase().includes(search.toLowerCase())
  )
  const filtered = allFiltered.filter(t => !isLibraryTemplate(t))
  const libraryFiltered = allFiltered.filter(t => isLibraryTemplate(t))

  const selected = templates.find(t => t.id === selectedId)
  const selectedIsLibrary = selected ? isLibraryTemplate(selected) : false

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

  // Flush pending auto-save for the current template, then switch to another
  const switchTemplate = async (id: string, view: string = 'edit') => {
    if (flushTimerRef.current && draftDirtyRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
      await flushDraft()
    }
    setSelectedId(id)
    setView(view)
  }

  const saveModal = async () => {
    try {
      if (editingId) {
        await onUpdate({ id: editingId, name: form.name })
      } else {
        const created = await onCreate({
          name: form.name,
          subject: form.subject || '(no subject)',
          body: '<p></p>',
          attachmentIds: defaultAttachmentIds(workspaceConfig),
        })
        if (created?.id) setSelectedId(created.id)
      }
      setEditModal(false)
    } catch (err: any) {
      showToast({ type: 'error', title: editingId ? 'Could not rename template' : 'Could not create template', message: err?.message || 'Please try again.' })
    }
  }

  const duplicate = async (t) => {
    try {
      const created = await onCreate({
        name: `${t.name} (copy)`,
        subject: t.subject,
        body: t.body,
        attachmentIds: sanitizeAttachmentIds(t.attachmentIds),
        isShared: false,
      })
      if (created?.id) setSelectedId(created.id)
    } catch (err: any) {
      showToast({ type: 'error', title: 'Could not duplicate template', message: err?.message || 'Please try again.' })
    }
  }

  return (
    <div className="page-shell">
      <div className="workspace">
        <header className="border-b border-warm-200 px-6 pb-6 pt-8 sm:px-10 sm:pt-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="page-eyebrow">Templates</p>
              <h1 className="mt-3 font-display text-[2rem] font-semibold leading-tight text-dark">Reusable templates</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                Edit the starting point for generated drafts.
              </p>
            </div>
            <button onClick={openCreate} className="btn-primary self-start sm:self-auto">
              <Plus size={14} /> New template
            </button>
          </div>
        </header>

        <div className="grid gap-0 xl:grid-cols-[320px_minmax(0,1fr)] xl:items-start xl:divide-x xl:divide-warm-200">
          <aside className="surface-panel flex h-fit flex-col gap-4 p-4 xl:sticky xl:top-6 xl:p-6">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input aria-label="Search templates" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates…" className="input pl-9 text-sm" />
          </div>

          <div className="space-y-4 overflow-y-auto pr-1 xl:max-h-[calc(100vh-180px)]">
            <div className="space-y-2">
              {filtered.map(t => (
                <button
                  key={t.id}
                  onClick={() => switchTemplate(t.id, 'edit')}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition-colors duration-150 ${
                    selectedId === t.id
                      ? 'border-primary/30 bg-primary/8'
                      : 'border-transparent hover:border-warm-200 hover:bg-warm-100'
                  }`}
                >
                  <p className={`truncate text-sm font-medium ${selectedId === t.id ? 'text-primary' : 'text-dark/90'}`}>{t.name}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <span className="min-w-0 flex-1 truncate">{t.subject || 'No subject yet'}</span>
                    {sanitizeAttachmentIds(t.attachmentIds).length > 0 && (
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <Paperclip size={10} /> {sanitizeAttachmentIds(t.attachmentIds).length}
                      </span>
                    )}
                  </div>
                </button>
              ))}
              {filtered.length === 0 && !search && (
                <p className="px-1 text-xs text-muted">No templates yet. Create one above.</p>
              )}
              {filtered.length === 0 && search && (
                <p className="px-1 text-xs text-muted">No templates match.</p>
              )}
            </div>

            {libraryFiltered.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 px-1 pt-1">
                  <Library size={11} className="text-muted" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Library</p>
                </div>
                {libraryFiltered.map(t => (
                  <button
                    key={t.id}
                    onClick={() => switchTemplate(t.id, 'preview')}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-colors duration-150 ${
                      selectedId === t.id
                        ? 'border-primary/30 bg-primary/8'
                        : 'border-transparent hover:border-warm-200 hover:bg-warm-100'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <p className={`truncate text-sm font-medium ${selectedId === t.id ? 'text-primary' : 'text-dark/90'}`}>{t.name}</p>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">{t.subject || 'No subject yet'}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="space-y-4 p-4 xl:p-6">
          {!selected ? (
            <EmptyState>Select or create a template to start editing.</EmptyState>
          ) : (
            <>
              <div className="surface-panel">
                {/* Name row + actions */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-2xl font-semibold text-dark">{selected.name}</h2>
                      {selectedIsLibrary && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warm-100 px-2.5 py-1 text-[11px] font-medium text-muted">
                          <Library size={10} /> Library
                        </span>
                      )}
                      {workspaceConfig?.templateId === selected.id && (
                        <Badge variant="draft">Default</Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {!selectedIsLibrary && saved && (
                      <span className="inline-flex items-center gap-1 text-xs text-primary/80">
                        <Check size={11} /> Saved
                      </span>
                    )}
                    {selectedIsLibrary ? (
                      <button onClick={() => duplicate(selected)} className="btn-primary text-xs">
                        <Copy size={13} /> Clone to my templates
                      </button>
                    ) : (
                      <div className="relative" ref={moreRef}>
                        <button
                          type="button"
                          onClick={() => setMoreOpen(o => !o)}
                          className="btn-ghost p-2 text-muted hover:text-dark"
                          title="More options"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        {moreOpen && (
                          <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[160px] rounded-2xl border border-accent/20 bg-panel py-1.5 shadow-modal animate-fade-in">
                            <button
                              type="button"
                              onClick={() => { setMoreOpen(false); duplicate(selected) }}
                              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-dark transition-colors hover:bg-warm-100"
                            >
                              <Copy size={13} className="text-muted" /> Duplicate
                            </button>
                            <button
                              type="button"
                              onClick={() => { setMoreOpen(false); openRename(selected) }}
                              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-dark transition-colors hover:bg-warm-100"
                            >
                              <Edit3 size={13} className="text-muted" /> Rename
                            </button>
                            <div className="my-1 h-px bg-accent/15" />
                            <button
                              type="button"
                              onClick={() => { setMoreOpen(false); setDeleteTarget(selected.id) }}
                              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 transition-colors hover:bg-red-50"
                            >
                              <Trash2 size={13} /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Underline tab nav - matches workspace sub-tab pattern */}
                {!selectedIsLibrary && (
                  <nav className="mt-4 flex gap-1 border-b border-warm-200">
                    <button
                      type="button"
                      onClick={() => setView('edit')}
                      className={`relative px-3 py-2.5 text-sm font-medium transition-colors ${
                        view === 'edit'
                          ? 'text-dark after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
                          : 'text-muted hover:text-dark'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5"><Edit3 size={13} /> Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('preview')}
                      className={`relative px-3 py-2.5 text-sm font-medium transition-colors ${
                        view === 'preview'
                          ? 'text-dark after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
                          : 'text-muted hover:text-dark'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5"><Eye size={13} /> Preview</span>
                    </button>
                  </nav>
                )}
              </div>

              {view === 'edit' && !selectedIsLibrary ? (
                <div className="space-y-5 surface-panel px-5 py-5">
                  <div>
                    <label htmlFor="template-editor-subject" className="label">Subject line</label>
                    <input
                      id="template-editor-subject"
                      value={draft.id === selected.id ? draft.subject : (selected.subject || '')}
                      onChange={e => scheduleFlush({ ...draft, id: selected.id, subject: e.target.value })}
                      onBlur={() => flushDraft()}
                      placeholder="e.g. Quick question about {{company}}"
                      className="input"
                    />
                  </div>
                  <div>
                    <span className="label">Body</span>
                    <RichEditor
                      key={selected.id}
                      content={selected.body}
                      onChange={body => scheduleFlush({ ...draft, id: selected.id, body })}
                      placeholder="Write your email here… Use the variable buttons to insert recipient details."
                      ariaLabel="Template body"
                    />
                  </div>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-warm-200 bg-warm-50/60 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={Boolean(selected.verbatim)}
                      onChange={e => onUpdate({ id: selected.id, verbatim: e.target.checked }).catch((err: any) => {
                        showToast({ type: 'error', title: 'Could not update template', message: err?.message || 'Please try again.' })
                      })}
                      className="mt-0.5 cursor-pointer"
                    />
                    <span className="text-sm">
                      <span className="font-medium text-dark">Send this template verbatim</span>
                      <span className="block text-xs text-muted">
                        Skip the AI rewrite — keep the wording exactly as authored, only fill merge tags including
                        {' '}<span className="font-mono text-primary">{'{{feature_line}}'}</span> from web research.
                        Missing research-only lines are removed instead of rewritten. Changes apply to newly generated drafts.
                      </span>
                    </span>
                  </label>
                  {attachmentLibrary.length > 0 && (
                    <div className="space-y-3 rounded-xl border border-warm-200 bg-warm-50/50 px-4 py-4">
                      <div>
                        <p className="text-sm font-semibold text-dark">Attachments</p>
                        <p className="mt-0.5 text-xs text-muted">Included when drafts are generated from this template.</p>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {attachmentLibrary.map(file => {
                          const selectedIds = sanitizeAttachmentIds(selected.attachmentIds)
                          const checked = selectedIds.includes(file.id)
                          return (
                            <label key={file.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-warm-200 bg-panel px-3 py-2 transition-colors hover:border-primary/20 hover:bg-primary/5">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => onUpdate({
                                  id: selected.id,
                                  attachmentIds: checked
                                    ? selectedIds.filter(id => id !== file.id)
                                    : [...selectedIds, file.id],
                                }).catch((err: any) => {
                                  showToast({ type: 'error', title: 'Could not update attachments', message: err?.message || 'Please try again.' })
                                })}
                                className="rounded border-warm-300"
                              />
                              {file.source === 'resume' ? <FileText size={13} className="shrink-0 text-primary" /> : <Paperclip size={13} className="shrink-0 text-muted" />}
                              <span className="min-w-0 flex-1 truncate text-sm text-dark">{file.fileName}</span>
                              {file.source === 'resume' && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Resume</span>}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-warm-200 bg-panel">
                  <div className="border-b border-warm-200 bg-warm-50/60 px-6 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted/80">Preview</p>
                    <p className="mt-2 text-sm font-medium text-dark">
                      {fillVariables(draft.id === selected.id ? draft.subject : selected.subject, previewData)}
                    </p>
                  </div>
                  <div
                    className="email-body max-w-none bg-panel p-6 text-dark"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(fillVariables(draft.id === selected.id ? draft.body : selected.body, previewData)) }}
                  />
                </div>
              )}
            </>
          )}
        </section>
        </div>
      </div>

      <Modal open={editModal} onClose={() => setEditModal(false)} title={editingId ? 'Rename template' : 'New template'} size="sm">
        <div className="px-6 py-5 space-y-4">
          <div>
            <label htmlFor="template-modal-name" className="label">Template name *</label>
            <input
              id="template-modal-name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && form.name && saveModal()}
              placeholder="e.g. Cold Intro - Startup Founder"
              className="input"
              autoFocus
            />
          </div>
          {!editingId && (
            <div>
              <label htmlFor="template-modal-subject" className="label">Subject line</label>
              <input
                id="template-modal-subject"
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                placeholder="e.g. Quick question about {{company}}"
                className="input"
              />
              <p className="mt-2 text-xs text-muted">
                Add variables like <span className="font-mono text-primary">{'{{company}}'}</span> or <span className="font-mono text-primary">{'{{first_name}}'}</span>.
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
            showToast({ type: 'error', title: 'Could not delete template', message: err?.message || 'Please try again.' })
          }
        }}
        title="Delete template"
        message="Delete this template? Any campaigns using it will need to be updated."
      />
    </div>
  )
}
