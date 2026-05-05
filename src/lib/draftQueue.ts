export type DraftLike = {
  id: string
  subject?: string | null
  body?: string | null
  createdAt?: string | Date | null
  sentAt?: string | Date | null
  contact?: { name?: string | null; email?: string | null } | null
  customContact?: { name?: string | null; email?: string | null; companyName?: string | null } | null
  userLead?: { company?: { name?: string | null } | null } | null
}

export type DraftReadiness = {
  variant: 'failed' | 'paused' | 'ready'
  label: 'Needs recipient' | 'Needs edit' | 'Ready'
}

export type DraftSortKey = 'createdAt' | 'name' | 'company' | 'subject'
export type DraftSortDirection = 'asc' | 'desc'
export type DraftReviewFilter = 'all' | 'ready' | 'needsReview' | 'needsRecipient'

export function stripDraftHtml(html?: string | null) {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function textToDraftHtml(text?: string | null) {
  if (!text) return ''
  if (text.includes('<')) return text
  return text
    .split(/\n{2,}/)
    .map(block => `<p style="margin:0 0 0.75em">${block.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export function htmlToEditableText(html?: string | null) {
  if (!html) return ''
  if (!html.includes('<')) return html
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function getRecipient(draft: DraftLike) {
  return draft.contact?.email || draft.customContact?.email || ''
}

export function getRecipientName(draft: DraftLike) {
  return draft.contact?.name || draft.customContact?.name || 'Contact'
}

export function getCompanyName(draft: DraftLike) {
  return draft.userLead?.company?.name || draft.customContact?.companyName || ''
}

export function draftReadiness(draft: DraftLike): DraftReadiness {
  if (!getRecipient(draft)) return { variant: 'failed', label: 'Needs recipient' }
  if (!draft.subject?.trim() || !stripDraftHtml(draft.body).trim()) return { variant: 'paused', label: 'Needs edit' }
  return { variant: 'ready', label: 'Ready' }
}

export function canSendDraft(draft: DraftLike) {
  return draftReadiness(draft).label === 'Ready'
}

export function sortDrafts<T extends DraftLike>(
  drafts: T[],
  opts: { key: DraftSortKey | string; direction: DraftSortDirection | string; tab: 'draft' | 'sent' | string },
) {
  return [...drafts].sort((a, b) => {
    let av: string | Date | null | undefined
    let bv: string | Date | null | undefined
    if (opts.key === 'name') {
      av = getRecipientName(a)
      bv = getRecipientName(b)
    } else if (opts.key === 'company') {
      av = getCompanyName(a)
      bv = getCompanyName(b)
    } else if (opts.key === 'subject') {
      av = a.subject || ''
      bv = b.subject || ''
    } else {
      av = opts.tab === 'sent' ? (a.sentAt || '') : (a.createdAt || '')
      bv = opts.tab === 'sent' ? (b.sentAt || '') : (b.createdAt || '')
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return opts.direction === 'asc' ? cmp : -cmp
  })
}

export function filterDrafts<T extends DraftLike>(drafts: T[], reviewFilter: DraftReviewFilter | string) {
  if (reviewFilter === 'all') return drafts
  return drafts.filter(draft => {
    const status = draftReadiness(draft).label
    if (reviewFilter === 'ready') return status === 'Ready'
    if (reviewFilter === 'needsReview') return status !== 'Ready'
    if (reviewFilter === 'needsRecipient') return status === 'Needs recipient'
    return true
  })
}

export function nextReviewDraft<T extends DraftLike>(
  sortedDrafts: T[],
  currentId: string | null,
  sentIds: string[],
) {
  const remaining = sortedDrafts.filter(draft => !sentIds.includes(draft.id) && canSendDraft(draft))
  if (!remaining.length) return null
  if (!currentId) return remaining[0]

  const currentIndex = sortedDrafts.findIndex(draft => draft.id === currentId)
  const after = sortedDrafts
    .slice(Math.max(currentIndex + 1, 0))
    .find(draft => !sentIds.includes(draft.id) && canSendDraft(draft))
  return after || remaining[0]
}
