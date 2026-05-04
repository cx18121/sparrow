import React from 'react'
import { Building2, MapPin, Users } from 'lucide-react'
import Modal from '../ui/Modal'
import Banner from '../ui/Banner'
import type { useDraftFlow } from '../../hooks/useDraftFlow'

type DraftFlow = ReturnType<typeof useDraftFlow>

interface DraftPreviewModalProps {
  lead: any | null
  draftFlow: DraftFlow
  onClose: () => void
  onSave: () => void
}

// Renders the preview / save UI for a generated Draft. Owns no flow state of
// its own — pulls from the supplied useDraftFlow instance. Both CampaignsTab
// and (eventually) ContactsTab can mount it.
export default function DraftPreviewModal({ lead, draftFlow, onClose, onSave }: DraftPreviewModalProps) {
  return (
    <Modal
      open={Boolean(lead)}
      onClose={onClose}
      title={lead ? `Email for ${lead.company?.name || 'contact'}` : 'Generated email'}
      size="md"
    >
      <div className="px-6 py-4 space-y-4">
        {lead && (
          <div className="rounded-[16px] border border-warm-200 bg-warm-50 px-4 py-3 text-xs text-muted space-y-1">
            <div className="flex items-center gap-4">
              {lead.company?.name && (
                <span className="flex items-center gap-1"><Building2 size={10} /> {lead.company.name}</span>
              )}
              {lead.company?.industry && <span>{lead.company.industry}</span>}
              {lead.company?.region && (
                <span className="flex items-center gap-1"><MapPin size={10} /> {lead.company.region}</span>
              )}
            </div>
            {lead.contact && (
              <div className="flex items-center gap-1 text-warm-600">
                <Users size={10} />
                {lead.contact.name || 'Contact'}
                {lead.contact.title && ` - ${lead.contact.title}`}
                {lead.contact.email && (
                  <span className="ml-1 text-primary">{lead.contact.email}</span>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="label">Subject</label>
          <input
            value={draftFlow.subject}
            onChange={e => draftFlow.setSubject(e.target.value)}
            className="input"
            placeholder="Subject line"
          />
        </div>

        <div>
          <label className="label">Body</label>
          <textarea
            value={draftFlow.body}
            onChange={e => draftFlow.setBody(e.target.value)}
            rows={14}
            className="input resize-y text-sm leading-relaxed"
            placeholder="Email body..."
          />
        </div>

        {draftFlow.error && <Banner variant="danger" size="sm">{draftFlow.error}</Banner>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary">Discard</button>
          <button
            onClick={onSave}
            disabled={draftFlow.saving}
            className="btn-primary"
          >
            {draftFlow.saving ? 'Saving...' : 'Save to drafts'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
