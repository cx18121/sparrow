// useDraftFlow — the single, canonical generate-preview-save flow for a Draft.
//
// Replaces two near-identical inline flows in CampaignsTab and ContactsTab.
// Owns: generate-with-AI / template, edit subject + body, save as Draft.
// Server is asked to generate with save:false so the user always reviews
// before persistence (see ADR-implicit "explicit save opt-in" — server default
// is now false; bulk-generate paths opt in via save:true).

import { useRef, useState } from 'react'
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

export interface BulkGenerateResult {
  succeeded: number
  failed: number
  // Non-zero when a concurrent generate was already in flight; the call was
  // a no-op rather than racing.
  skipped: number
}

export function useDraftFlow() {
  const [state, setState] = useState<DraftFlowState>({
    subject: '', body: '', generating: false, saving: false, error: null, generated: false,
  })
  // Reentrancy guard. Shared between single + bulk paths so a stray double-
  // click never fires two parallel generates against the same hook instance.
  // A ref (not state) avoids the closure-stale problem where two rapid calls
  // both see `generating: false` before either re-render lands.
  const inFlightRef = useRef(false)

  const reset = () => {
    inFlightRef.current = false
    setState({
      subject: '', body: '', generating: false, saving: false, error: null, generated: false,
    })
  }

  const setSubject = (subject: string) => setState(s => ({ ...s, subject }))
  const setBody = (body: string) => setState(s => ({ ...s, body }))

  // Generate a preview. Server is told save:false — nothing persists yet.
  const generate = async (target: DraftTarget, opts: DraftFlowOptions = {}) => {
    if (inFlightRef.current) {
      throw new Error('A draft generation is already in progress')
    }
    inFlightRef.current = true
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
    } finally {
      inFlightRef.current = false
    }
  }

  // Bulk-generate N drafts in parallel. Unlike single generate (preview-only),
  // bulk explicitly opts into save:true — the user's intent with bulk is
  // "make me drafts to review later," so each result is persisted on the
  // server. Returns a summary so the caller can render a single toast.
  // Skips entirely if a generate is already in flight on this hook instance.
  const bulkGenerate = async (
    targets: DraftTarget[],
    opts: DraftFlowOptions = {},
  ): Promise<BulkGenerateResult> => {
    if (inFlightRef.current) {
      return { succeeded: 0, failed: 0, skipped: targets.length }
    }
    if (targets.length === 0) return { succeeded: 0, failed: 0, skipped: 0 }
    inFlightRef.current = true
    setState(s => ({ ...s, generating: true, error: null }))
    try {
      const results = await Promise.allSettled(targets.map(target => {
        const payload = target.kind === 'custom'
          ? { customContactId: target.id, ...opts, save: true }
          : { userLeadId: target.id, ...opts, save: true }
        return generateEmail(payload)
      }))
      const succeeded = results.filter(r => r.status === 'fulfilled').length
      const failed = results.length - succeeded
      setState(s => ({ ...s, generating: false }))
      return { succeeded, failed, skipped: 0 }
    } finally {
      inFlightRef.current = false
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

  return { ...state, setSubject, setBody, generate, save, reset, bulkGenerate }
}
