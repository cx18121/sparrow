import React, { useState, useEffect } from 'react'
import { Plus, Trash2, GripVertical, Mail, Clock, Edit2 } from 'lucide-react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'

function SortableStep({ step, stepIndex, onEdit, onDelete, templates, isOnly }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const tpl = templates.find(t => t.id === step.templateId)

  return (
    <div ref={setNodeRef} style={style} className="relative">
      <div className="flex items-start gap-3 group">
        <div
          {...attributes}
          {...listeners}
          className="drag-handle mt-5 text-slate-300 transition-colors hover:text-primary"
        >
          <GripVertical size={16} />
        </div>

        <div className="flex-1 p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {stepIndex + 1}
              </div>
              <span className="text-sm font-medium text-dark">{step.name || `Step ${stepIndex + 1}`}</span>
            </div>
            <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
              <button onClick={() => onEdit(step)} className="btn-ghost px-2 py-1"><Edit2 size={12} /></button>
              {!isOnly && (
                <button onClick={() => onDelete(step.id)} className="btn-ghost px-2 py-1 hover:text-red-500"><Trash2 size={12} /></button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1">
              <Mail size={11} />
              {tpl ? tpl.name : <span className="italic text-amber-600">No template selected</span>}
            </span>
          </div>
        </div>
      </div>

      {step._showWait && (
        <div className="my-2 ml-10 flex items-center gap-3 pl-4">
          <div className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
            <Clock size={10} />
            Wait {step.waitDays} {step.waitDays === 1 ? 'day' : 'days'}
          </div>
          <div className="flex-1 border-t border-dashed border-white/90" />
        </div>
      )}
    </div>
  )
}

export default function SequencesTab({ sequences, onCreate, onUpdate, onDelete, templates, workspaceConfig }) {
  const createStepDefaults = () => ({
    name: '',
    templateId: workspaceConfig?.templateId || '',
    waitDays: 3,
  })

  const [selectedId, setSelectedId] = useState(sequences[0]?.id || null)
  const [seqModal, setSeqModal] = useState(false)
  const [seqForm, setSeqForm] = useState({ name: '', description: '' })
  const [stepModal, setStepModal] = useState(false)
  const [stepForm, setStepForm] = useState(createStepDefaults)
  const [editingStep, setEditingStep] = useState(null)
  const [deleteSeqTarget, setDeleteSeqTarget] = useState(null)

  useEffect(() => {
    if (!selectedId && sequences.length > 0) setSelectedId(sequences[0].id)
    if (selectedId && !sequences.some(s => s.id === selectedId)) {
      setSelectedId(sequences[0]?.id || null)
    }
  }, [sequences, selectedId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const selected = sequences.find(s => s.id === selectedId)

  // Convert a UI step (which may have a client-only id from drag-drop) into
  // the StepInput shape the API expects. The API re-keys SequenceStep rows
  // on every PATCH, so we strip ids.
  const toApiSteps = (steps) => steps.map((s, i) => ({
    order: i,
    name: s.name || `Step ${i + 1}`,
    templateId: s.templateId || null,
    waitDays: typeof s.waitDays === 'number' ? s.waitDays : 0,
  }))

  const createSequence = async () => {
    try {
      const created = await onCreate({
        name: seqForm.name,
        description: seqForm.description,
        steps: [{ order: 0, name: 'Initial Email', templateId: workspaceConfig?.templateId || null, waitDays: 0 }],
      })
      if (created?.id) setSelectedId(created.id)
      setSeqModal(false)
      setSeqForm({ name: '', description: '' })
    } catch (err) {
      console.error('Failed to create sequence', err)
    }
  }

  const deleteSequence = async (id) => {
    try {
      await onDelete(id)
      if (selectedId === id) setSelectedId(sequences.find(s => s.id !== id)?.id || null)
    } catch (err) {
      console.error('Failed to delete sequence', err)
    }
  }

  const persistSteps = (steps) => {
    if (!selected) return
    onUpdate({ id: selected.id, steps: toApiSteps(steps) }).catch(err => {
      console.error('Failed to save sequence steps', err)
    })
  }

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id || !selected) return
    const oldIndex = selected.steps.findIndex(s => s.id === active.id)
    const newIndex = selected.steps.findIndex(s => s.id === over.id)
    const reordered = arrayMove(selected.steps, oldIndex, newIndex).map((s, i) => ({ ...s, order: i }))
    persistSteps(reordered)
  }

  const addStep = () => {
    setEditingStep(null)
    setStepForm(createStepDefaults())
    setStepModal(true)
  }

  const editStep = (step) => {
    setEditingStep(step.id)
    setStepForm({ name: step.name, templateId: step.templateId || '', waitDays: step.waitDays })
    setStepModal(true)
  }

  const saveStep = () => {
    if (!selected) return
    let nextSteps
    if (editingStep) {
      nextSteps = selected.steps.map(s => s.id === editingStep ? { ...s, ...stepForm } : s)
    } else {
      // Placeholder id — the API re-keys on PATCH anyway.
      const step = { id: `tmp-${Date.now()}`, order: selected.steps.length, ...stepForm }
      nextSteps = [...selected.steps, step]
    }
    persistSteps(nextSteps)
    setStepModal(false)
  }

  const deleteStep = (stepId) => {
    if (!selected) return
    persistSteps(selected.steps.filter(s => s.id !== stepId).map((s, i) => ({ ...s, order: i })))
  }

  const stepsWithWait = selected?.steps.slice().sort((a, b) => a.order - b.order).map((s, i, arr) => ({
    ...s,
    _showWait: i < arr.length - 1 && arr[i + 1]?.waitDays > 0,
    waitDays: arr[i + 1]?.waitDays || 0,
  })) || []
  const defaultTemplate = templates.find(template => template.id === workspaceConfig?.templateId)

  return (
    <div className="page-shell space-y-6">
      <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)] xl:items-start">
        <aside className="flex h-fit flex-col gap-4 xl:sticky xl:top-6">
          <button onClick={() => setSeqModal(true)} className="btn-primary w-full justify-center text-xs">
            <Plus size={13} /> New sequence
          </button>

          <div className="max-h-[calc(100vh-320px)] space-y-2 overflow-y-auto pr-1">
            {sequences.map(s => (
              <div
                key={s.id}
                className={`w-full rounded-[24px] border px-4 py-3 text-left transition-all duration-150 ${
                  selectedId === s.id
                    ? 'border-primary/15 bg-primary/5 shadow-[0_16px_32px_rgba(27,110,243,0.08)]'
                    : 'border-white/70 bg-white/70 hover:-translate-y-0.5 hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className={`truncate text-sm font-medium ${selectedId === s.id ? 'text-primary' : 'text-dark'}`}>
                      {s.name}
                    </p>
                    <p className="mt-1 text-xs text-muted">{s.steps.length} step{s.steps.length !== 1 ? 's' : ''}</p>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDeleteSeqTarget(s.id) }}
                    className="btn-ghost p-1 text-muted hover:text-red-500"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
            {sequences.length === 0 && (
              <div className="empty-state border-0 bg-transparent px-4 py-10 text-xs shadow-none">No sequences yet. Create one to get started.</div>
            )}
          </div>
        </aside>

        <section className="space-y-4">
          {!selected ? (
            <div className="empty-state">Select or create a sequence to start building.</div>
          ) : (
            <>
              <div className="page-toolbar">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">Editing sequence</p>
                    <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-dark">{selected.name}</h2>
                    {selected.description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{selected.description}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-full border border-white/80 bg-white/82 px-3 py-1.5 text-sm text-muted">
                      {selected.steps.length} step{selected.steps.length !== 1 ? 's' : ''}
                    </div>
                    <button onClick={addStep} className="btn-primary text-xs">
                      <Plus size={13} /> Add step
                    </button>
                  </div>
                </div>
              </div>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={stepsWithWait.map(s => s.id)} strategy={verticalListSortingStrategy}>
                  <div className="max-w-3xl space-y-1">
                    {stepsWithWait.map((step, i) => (
                      <SortableStep
                        key={step.id}
                        step={step}
                        stepIndex={i}
                        onEdit={editStep}
                        onDelete={deleteStep}
                        templates={templates}
                        isOnly={stepsWithWait.length === 1}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </>
          )}
        </section>
      </div>

      {/* New sequence modal */}
      <Modal open={seqModal} onClose={() => setSeqModal(false)} title="New sequence" size="sm">
        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="label">Sequence name *</label>
            <input value={seqForm.name} onChange={e => setSeqForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. 3-Touch Startup Sequence" className="input" />
          </div>
          <div>
            <label className="label">Description</label>
            <input value={seqForm.description} onChange={e => setSeqForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description…" className="input" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setSeqModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={createSequence} disabled={!seqForm.name} className="btn-primary">Create</button>
          </div>
        </div>
      </Modal>

      {/* Edit step modal */}
      <Modal open={stepModal} onClose={() => setStepModal(false)} title={editingStep ? 'Edit step' : 'Add step'} size="md">
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="label">Step name</label>
            <input value={stepForm.name} onChange={e => setStepForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Initial Email" className="input" />
          </div>
          <div>
            <label className="label">Template</label>
            <select value={stepForm.templateId} onChange={e => setStepForm(f => ({ ...f, templateId: e.target.value }))} className="select">
              <option value="">Select template…</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Wait before this step (days)</label>
            <input
              type="number" min={0} max={90}
              value={stepForm.waitDays}
              onChange={e => setStepForm(f => ({ ...f, waitDays: parseInt(e.target.value) || 0 }))}
              className="input"
            />
            <p className="text-xs text-muted mt-1">Set 0 for the first step or to send immediately.</p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setStepModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={saveStep} className="btn-primary">
              {editingStep ? 'Save step' : 'Add step'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteSeqTarget}
        onClose={() => setDeleteSeqTarget(null)}
        onConfirm={() => deleteSequence(deleteSeqTarget)}
        title="Delete sequence"
        message="Are you sure you want to delete this sequence? All steps will be removed."
      />
    </div>
  )
}
