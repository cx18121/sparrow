import React, { useState } from 'react'
import { Plus, Trash2, GripVertical, ChevronRight, Mail, Clock, GitBranch, Edit2 } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragOverlay,
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
      {/* Step card */}
      <div className="flex items-start gap-3 group">
        <div
          {...attributes}
          {...listeners}
          className="drag-handle mt-3.5 text-gray-300 hover:text-muted transition-colors"
        >
          <GripVertical size={16} />
        </div>

        <div className="flex-1 card p-4 hover:border-primary/30 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary text-white text-xs font-semibold flex items-center justify-center">
                {stepIndex + 1}
              </div>
              <span className="text-sm font-medium text-dark">{step.name || `Step ${stepIndex + 1}`}</span>
              {step.variants.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
                  <GitBranch size={10} /> A/B
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
            {step.variants.length > 0 && (
              <span className="text-purple-600">{step.variants.length + 1} variants</span>
            )}
          </div>
        </div>
      </div>

      {/* Wait connector — shown between steps */}
      {step._showWait && (
        <div className="flex items-center gap-2 my-1 ml-10 pl-4">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full text-xs text-amber-700">
            <Clock size={10} />
            Wait {step.waitDays} {step.waitDays === 1 ? 'day' : 'days'}
          </div>
          <div className="flex-1 border-t border-dashed border-gray-200" />
        </div>
      )}
    </div>
  )
}

const STEP_DEFAULTS = { name: '', templateId: '', waitDays: 3, variants: [] }

export default function SequencesTab({ sequences, setSequences, templates }) {
  const [selectedId, setSelectedId] = useState(sequences[0]?.id || null)
  const [seqModal, setSeqModal] = useState(false)
  const [seqForm, setSeqForm] = useState({ name: '', description: '' })
  const [stepModal, setStepModal] = useState(false)
  const [stepForm, setStepForm] = useState(STEP_DEFAULTS)
  const [editingStep, setEditingStep] = useState(null)
  const [deleteSeqTarget, setDeleteSeqTarget] = useState(null)
  const [variantInput, setVariantInput] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const selected = sequences.find(s => s.id === selectedId)

  const createSequence = () => {
    const now = new Date().toISOString()
    const id = uuidv4()
    const seq = {
      id, name: seqForm.name, description: seqForm.description,
      steps: [{ id: uuidv4(), order: 0, name: 'Initial Email', templateId: '', waitDays: 0, variants: [] }],
      createdAt: now, updatedAt: now,
    }
    setSequences(prev => [...prev, seq])
    setSelectedId(id)
    setSeqModal(false)
    setSeqForm({ name: '', description: '' })
  }

  const deleteSequence = (id) => {
    setSequences(prev => prev.filter(s => s.id !== id))
    if (selectedId === id) setSelectedId(sequences.find(s => s.id !== id)?.id || null)
  }

  const updateSteps = (steps) => {
    setSequences(prev => prev.map(s =>
      s.id === selectedId ? { ...s, steps, updatedAt: new Date().toISOString() } : s
    ))
  }

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id || !selected) return
    const oldIndex = selected.steps.findIndex(s => s.id === active.id)
    const newIndex = selected.steps.findIndex(s => s.id === over.id)
    const reordered = arrayMove(selected.steps, oldIndex, newIndex).map((s, i) => ({ ...s, order: i }))
    updateSteps(reordered)
  }

  const addStep = () => {
    setEditingStep(null)
    setStepForm(STEP_DEFAULTS)
    setVariantInput('')
    setStepModal(true)
  }

  const editStep = (step) => {
    setEditingStep(step.id)
    setStepForm({ name: step.name, templateId: step.templateId || '', waitDays: step.waitDays, variants: [...step.variants] })
    setVariantInput('')
    setStepModal(true)
  }

  const saveStep = () => {
    if (!selected) return
    if (editingStep) {
      updateSteps(selected.steps.map(s => s.id === editingStep ? { ...s, ...stepForm } : s))
    } else {
      const step = { id: uuidv4(), order: selected.steps.length, ...stepForm }
      updateSteps([...selected.steps, step])
    }
    setStepModal(false)
  }

  const deleteStep = (stepId) => {
    if (!selected) return
    updateSteps(selected.steps.filter(s => s.id !== stepId).map((s, i) => ({ ...s, order: i })))
  }

  const addVariant = () => {
    if (!variantInput.trim()) return
    setStepForm(f => ({ ...f, variants: [...f.variants, { id: uuidv4(), label: variantInput.trim(), templateId: '' }] }))
    setVariantInput('')
  }

  const removeVariant = (id) => setStepForm(f => ({ ...f, variants: f.variants.filter(v => v.id !== id) }))

  const stepsWithWait = selected?.steps.slice().sort((a, b) => a.order - b.order).map((s, i, arr) => ({
    ...s,
    _showWait: i < arr.length - 1 && arr[i + 1]?.waitDays > 0,
    waitDays: arr[i + 1]?.waitDays || 0,
  })) || []

  return (
    <div className="flex h-[calc(100vh-112px)] animate-fade-in">
      {/* Sequence list sidebar */}
      <div className="w-64 border-r border-gray-100 bg-white flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <button onClick={() => setSeqModal(true)} className="btn-primary w-full justify-center text-xs py-2">
            <Plus size={13} /> New sequence
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {sequences.map(s => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`w-full text-left px-4 py-3 transition-colors group ${
                selectedId === s.id ? 'bg-primary/5 border-r-2 border-primary' : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className={`text-sm font-medium truncate ${selectedId === s.id ? 'text-primary' : 'text-dark'}`}>
                  {s.name}
                </p>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteSeqTarget(s.id) }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 text-muted transition-all"
                >
                  <Trash2 size={11} />
                </button>
              </div>
              <p className="text-xs text-muted mt-0.5">{s.steps.length} step{s.steps.length !== 1 ? 's' : ''}</p>
            </button>
          ))}
          {sequences.length === 0 && (
            <p className="text-xs text-muted text-center py-8 px-4">No sequences yet. Create one to get started.</p>
          )}
        </div>
      </div>

      {/* Builder area */}
      <div className="flex-1 overflow-y-auto p-6 bg-surface">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-muted text-sm">
            Select or create a sequence
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-lg font-display font-semibold text-dark">{selected.name}</h2>
              {selected.description && <p className="text-sm text-muted mt-0.5">{selected.description}</p>}
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={stepsWithWait.map(s => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-0 max-w-xl">
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

            <button onClick={addStep} className="btn-secondary mt-4 text-xs">
              <Plus size={13} /> Add step
            </button>
          </>
        )}
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

          {/* A/B Variants */}
          <div>
            <label className="label flex items-center gap-1"><GitBranch size={11} /> A/B Variants (optional)</label>
            {stepForm.variants.map(v => (
              <div key={v.id} className="flex items-center gap-2 mb-2">
                <span className="text-xs text-purple-600 font-medium w-8">{String.fromCharCode(66 + stepForm.variants.indexOf(v))}</span>
                <select
                  value={v.templateId}
                  onChange={e => setStepForm(f => ({ ...f, variants: f.variants.map(x => x.id === v.id ? { ...x, templateId: e.target.value } : x) }))}
                  className="select flex-1 text-xs py-1.5"
                >
                  <option value="">Select template…</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button onClick={() => removeVariant(v.id)} className="text-muted hover:text-red-500 transition-colors"><Trash2 size={12} /></button>
              </div>
            ))}
            <div className="flex gap-2">
              <button onClick={addVariant} className="btn-ghost text-xs py-1 px-2 text-purple-600">
                <Plus size={11} /> Add variant
              </button>
            </div>
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
