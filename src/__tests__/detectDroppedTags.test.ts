import { describe, it, expect } from 'vitest'
import { detectDroppedTags } from '../components/Drafts/DraftsTab'

// detectDroppedTags is the client-side heuristic that surfaces a
// "we dropped a paragraph" warning in DraftsTab when the picker filled
// one half of the role's (company-side, candidate-side) pair but not
// the other. The contract is:
//   - Only verbatim drafts qualify (other generationKinds rewrite the
//     body in prose, where dropped tags don't apply the same way).
//   - When exactly one half is populated, return the dropped tag(s) +
//     company name.
//   - When both halves are populated, no warning (personalization fired
//     fully).
//   - When both halves are empty, no warning is shown (we can't
//     determine which role's template was attempted without a server
//     hint — see the note in detectDroppedTags).

const baseCompany = { id: 'c1', name: 'Anthropic' }

function draft(role: 'eng' | 'gtm' | 'ops', partial: 'company' | 'candidate' | 'both' | 'neither') {
  const filled = (which: 'company' | 'candidate') =>
    partial === 'both' || partial === which
  const company = filled('company') ? 'a value' : null
  const candidate = filled('candidate') ? 'a value' : null
  const cols: Record<string, string | null> = {
    featureLine: null,
    fitAngle: null,
    gtmTriggerLine: null,
    gtmProofOfMotion: null,
    opsInflectionLine: null,
    opsSystemBuilt: null,
  }
  if (role === 'eng') {
    cols.featureLine = company
    cols.fitAngle = candidate
  } else if (role === 'gtm') {
    cols.gtmTriggerLine = company
    cols.gtmProofOfMotion = candidate
  } else {
    cols.opsInflectionLine = company
    cols.opsSystemBuilt = candidate
  }
  return {
    generationKind: 'verbatim',
    userLead: { company: baseCompany },
    ...cols,
  }
}

describe('detectDroppedTags', () => {
  it('flags the candidate-side tag when only the company-side line is filled (eng)', () => {
    const w = detectDroppedTags(draft('eng', 'company'))
    expect(w).toEqual({ droppedTags: ['{{fit_angle}}'], company: 'Anthropic' })
  })

  it('flags the company-side tag when only the candidate-side line is filled (eng)', () => {
    const w = detectDroppedTags(draft('eng', 'candidate'))
    expect(w).toEqual({ droppedTags: ['{{feature_line}}'], company: 'Anthropic' })
  })

  it('detects partial gtm personalization', () => {
    const w = detectDroppedTags(draft('gtm', 'company'))
    expect(w).toEqual({ droppedTags: ['{{proof_of_motion}}'], company: 'Anthropic' })
  })

  it('detects partial ops personalization', () => {
    const w = detectDroppedTags(draft('ops', 'candidate'))
    expect(w).toEqual({ droppedTags: ['{{inflection_line}}'], company: 'Anthropic' })
  })

  it('returns null when both halves are filled (no drop happened)', () => {
    expect(detectDroppedTags(draft('eng', 'both'))).toBeNull()
    expect(detectDroppedTags(draft('gtm', 'both'))).toBeNull()
    expect(detectDroppedTags(draft('ops', 'both'))).toBeNull()
  })

  it('returns null when both halves are empty (cannot determine which role was attempted)', () => {
    // This is the known gap: total picker failure is invisible because no
    // role column carries any signal. Documented in detectDroppedTags.
    expect(detectDroppedTags(draft('eng', 'neither'))).toBeNull()
  })

  it('returns null for non-verbatim drafts', () => {
    const d = draft('eng', 'company')
    expect(detectDroppedTags({ ...d, generationKind: 'ai' })).toBeNull()
    expect(detectDroppedTags({ ...d, generationKind: 'template' })).toBeNull()
    expect(detectDroppedTags({ ...d, generationKind: 'fallback' })).toBeNull()
  })

  it('falls back to customContact.companyName when there is no userLead', () => {
    const w = detectDroppedTags({
      generationKind: 'verbatim',
      customContact: { companyName: 'Stripe' },
      featureLine: 'a value',
      fitAngle: null,
    })
    expect(w?.company).toBe('Stripe')
  })

  it('returns null company when no recipient info is attached', () => {
    const w = detectDroppedTags({
      generationKind: 'verbatim',
      featureLine: 'a value',
      fitAngle: null,
    })
    expect(w?.company).toBeNull()
    expect(w?.droppedTags).toEqual(['{{fit_angle}}'])
  })
})
