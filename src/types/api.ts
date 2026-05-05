// Shared API response types — used by both client (src/lib/api.ts) and server routes.
// Mirrors prisma/schema.prisma. Update both together.
//
// IMPORTANT: only fields that are SELECTed and INCLUDEd in server queries are present
// here. The bare Prisma model types are richer; these reflect the wire shape.

// -------------------- Enums --------------------

export type LeadStatus = 'SAVED' | 'EMAILED' | 'NO_RESPONSE' | 'DECLINED'
export type CampaignStatusApi = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED'
export type CampaignStatusUi = 'draft' | 'active' | 'paused' | 'completed'
export type EmailStatus = 'draft' | 'sending' | 'sent' | 'failed'
export type RegionType = 'us' | 'international' | 'remote'

// -------------------- Sub-shapes --------------------

export interface CompanySummary {
  id: string
  name: string
  domain: string | null
  oneLiner?: string | null
  industry?: string | null
  region?: string | null
  stage?: string | null
  batch?: string | null
  isHiring?: boolean
  // GET /api/companies returns these too:
  website?: string | null
  location?: string | null
  _count?: { contacts: number }
}

export interface ContactSummary {
  id: string
  name: string | null
  email: string | null
  title: string | null
  role?: string | null
}

export interface EmailSummary {
  id: string
  subject: string | null
  status: EmailStatus
}

// -------------------- Models (wire shapes) --------------------

export interface UserLead {
  id: string
  userId: string
  companyId: string
  contactId: string | null
  apolloPersonId: string | null
  status: LeadStatus
  notes: string | null
  addedAt: string
  updatedAt: string
  // Included by GET /api/leads, /api/campaign-batch, /api/campaign-leads:
  company?: CompanySummary
  contact?: ContactSummary | null
  emails?: EmailSummary[]
  // Added by /api/campaign-leads and /api/campaign-batch (GET):
  campaignLeadId?: string
  batchNumber?: number
}

export interface CustomContact {
  id: string
  userId: string
  name: string | null
  email: string | null
  title: string | null
  companyName: string | null
  status: LeadStatus
  createdAt: string
  updatedAt: string
}

export interface Template {
  id: string
  userId: string
  name: string
  subject: string
  body: string
  isShared: boolean
  verbatim: boolean
  attachmentIds: string[]
  createdAt: string
  updatedAt: string
}

export interface Campaign {
  id: string
  userId: string
  name: string
  subject: string | null
  status: CampaignStatusApi
  templateId: string | null
  template?: { id: string; name: string } | null
  scheduledAt: string | null
  filterIndustry: string | null
  filterRegion: string | null
  filterStage: string | null
  filterBatch: string | null
  filterIsHiring: boolean | null
  filterHeadcountMin: number | null
  filterHeadcountMax: number | null
  filterTags: string[]
  batchSize: number
  currentBatch: number
  tone: string | null
  attachmentIds: string[]
  includePreviouslySaved: boolean
  createdAt: string
  updatedAt: string
}

export interface Email {
  id: string
  userLeadId: string | null
  contactId: string | null
  customContactId: string | null
  subject: string | null
  body: string | null
  status: EmailStatus
  attachmentIds: string[]
  sentAt: string | null
  createdAt: string
  updatedAt: string
  contact?: ContactSummary | null
  customContact?: { id: string; name: string | null; email: string | null; title: string | null; companyName: string | null } | null
  userLead?: { id: string; status: LeadStatus; company: CompanySummary } | null
}

// -------------------- API request/response envelopes --------------------

export interface PageResponse<T> {
  items: T[]
  nextCursor?: string | null
}

export interface CompanyListResponse {
  items: CompanySummary[]
  nextCursor?: string | null
  seenTotal?: number
  usingFallback?: boolean
  hasMore?: boolean
}

export interface CampaignBatchResponse {
  leads: UserLead[]
  total: number
  currentBatch: number
  seenTotal: number
  usingFallback?: boolean
}

export interface CampaignOptions {
  industries: string[]
  regions: string[]
  stages: string[]
  batches: string[]
  tags: Record<string, Array<{ name: string; namespaced: string; count: number }>>
  hiringCount?: number | null
  usCount?: number | null
  intlCount?: number | null
  remoteCount?: number | null
}

export interface ApolloPreview {
  id: string
  firstName: string | null
  lastNameObfuscated: string | null
  title: string | null
  hasEmail: boolean
  companyName?: string | null
}

export interface ApolloSearchResponse {
  previews: ApolloPreview[]
  companyId: string
  // True when the title-filtered search returned 0 and the server retried
  // without the title filter. The UI uses this to hint that contacts may
  // be more junior than the usual senior-only set.
  usedFallback: boolean
}

export interface ApolloRevealResponse {
  revealed: boolean
  contact?: {
    name: string | null
    email: string | null
    title: string | null
    linkedinUrl: string | null
  }
}

export interface GenerateEmailResponse {
  subject: string
  body: string
  emailId: string | null
  fallback?: true
  error?: string
}

export interface SendEmailResponse {
  success: true
  email: Email
}

export interface DashboardEmailsResponse {
  drafts: Email[]
  sent: Email[]
}

export interface SentTodayCountResponse {
  count: number
}
