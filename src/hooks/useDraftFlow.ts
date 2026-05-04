// useDraftFlow — the single, canonical generate-preview-save flow for a Draft.
//
// Replaces two near-identical inline flows in CampaignsTab and ContactsTab.
// Owns: generate-with-AI / template, edit subject + body, save as Draft.
// Server is asked to generate with save:false so the user always reviews
// before persistence (see ADR-implicit "explicit save opt-in" — server default
// is now false; bulk-generate paths opt in via save:true).

import { useState } from 'react'
import { generateEmail, createEmail } from '../lib/api'

export type DraftTarget =
  | { kind: 'lead'; id: string; companyName?: string | null; contactName?: string | null }
  | { kind: 'custom'; id: string; companyName?: string | null; contactName?: string | null }

export interface DraftFlowOptions {
  templateId?: string | null
  tone?: string | null
  includeResumeBullet?: boolean
  attachmentIds?: string[]
}

export interface DraftFlowState {
  subject: string
  body: string
  generating: boolean
  saving: boolean
  error: string | null
  generated: boolean
}

export function useDraftFlow() {
  const [state, setState] = useState<DraftFlowState>({
    subject: '', body: '', generating: false, saving: false, error: null, generated: false,
  })

  const reset = () => setState({
    subject: '', body: '', generating: false, saving: false, error: null, generated: false,
  })

  const setSubject = (subject: string) => setState(s => ({ ...s, subject }))
  const setBody = (body: string) => setState(s => ({ ...s, body }))

  // Generate a preview. Server is told save:false — nothing persists yet.
  const generate = async (target: DraftTarget, opts: DraftFlowOptions = {}) => {
    setState(s => ({ ...s, generating: true, error: null }))
    try {
      const payload = target.kind === 'custom'
        ? { customContactId: target.id, ...opts, save: false }
        : { userLeadId: target.id, ...opts, save: false }
      const res = await generateEmail(payload)
      setState({
        subject: res.subject || '', body: res.body || '',
        generating: false, saving: false, error: null, generated: true,
      })
    } catch (err: any) {
      setState(s => ({ ...s, generating: false, error: err?.message || 'Failed to generate email' }))
      throw err
    }
  }

  // Persist whatever the user is currently looking at (subject + body, edits included).
  const save = async (target: DraftTarget, attachmentIds: string[] = []) => {
    setState(s => ({ ...s, saving: true, error: null }))
    try {
      const payload = target.kind === 'custom'
        ? { customContactId: target.id, subject: state.subject, body: state.body, status: 'draft' as const, attachmentIds }
        : { userLeadId: target.id, subject: state.subject, body: state.body, status: 'draft' as const, attachmentIds }
      const saved = await createEmail(payload)
      setState(s => ({ ...s, saving: false }))
      return saved
    } catch (err: any) {
      setState(s => ({ ...s, saving: false, error: err?.message || 'Failed to save draft' }))
      throw err
    }
  }

  return { ...state, setSubject, setBody, generate, save, reset }
}
