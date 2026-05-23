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
  filterRegion: string[]
  filterStage: string[]
  filterBatch: string[]
  filterIsHiring: boolean | null
  filterTags: string[]
  batchSize: number
  currentBatch: number
  tone: string | null
  attachmentIds: string[]
  includePreviouslySaved: boolean
  // Aggregates included by GET /api/campaigns. Match the same campaign-scope
  // join the workspace dashboard uses, so Home and inside-campaign counts
  // agree. Optional so legacy callers that don't unpack them stay typed.
  leadCount?: number
  draftCount?: number
  sentCount?: number
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
  // Personalization metadata. Populated by the draft-generation path;
  // null for rows written by other paths or pre-migration. The picker on
  // the drafts review pane reads featureLine + userLead.company.researchDossier.surfaces
  // to surface the angle currently chosen and the alternatives available.
  featureLine?: string | null
  fitAngle?: string | null
  generationKind?: "verbatim" | "template" | "ai" | "fallback" | null
  contact?: ContactSummary | null
  customContact?: { id: string; name: string | null; email: string | null; title: string | null; companyName: string | null } | null
  userLead?: {
    id: string
    status: LeadStatus
    company: CompanySummary & { researchDossier?: ResearchDossier | null }
  } | null
}

// Cached web-research output per company. The `surfaces` list seeds the
// "change angle" picker on the drafts review pane; the rest of the
// fields are reserved for downstream UI that wants to show the dossier.
export interface ResearchDossier {
  summary: string
  surfaces: string[]
  recentLaunches: string[]
  technicalAreas: string[]
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

export interface DashboardSendStats {
  sentToday: number
  sentLast7Days: number
  sentThisMonth: number
  sentTotal: number
  repliedCount: number
}

export interface DashboardEmailsResponse {
  drafts: Email[]
  sent: Email[]
  stats: DashboardSendStats
}

export interface SentTodayCountResponse {
  count: number
}

// Server-side profile shape returned by /api/profile. The DB carries
// workspaceConfig and defaultFilters as JSON columns (Postgres jsonb), so
// the wire type is `unknown` — clients normalize via createWorkspaceConfig
// before reading individual fields. The capability booleans (hasClaudeKey,
// hasGoogleRefreshToken, hasGmailWatch) are derived server-side from env
// vars + DB columns so the client doesn't need to know about secrets.
//
// /api/profile returns { profile: null } for non-UUID user IDs (local dev
// bypass paths); the FetchProfileResponse type below carries that null.
export interface ServerProfile {
  // workspaceConfig is a JSON column from Supabase normalized to an object
  // by the server's sanitizeWorkspaceConfig — never null/undefined/array on
  // the wire. Inner shape is the client's WorkspaceConfig schema; callers
  // pass through createWorkspaceConfig to normalize.
  workspaceConfig: Record<string, unknown>
  defaultFilters: Record<string, unknown>
  resumePath: string | null
  resumeText: string | null
  onboardingCompleted: boolean
  onboardingCompletedAt: string | null
  hasClaudeKey: boolean
  hasGoogleRefreshToken: boolean
  hasGmailWatch: boolean
  updatedAt: string | null
}

export interface FetchProfileResponse {
  profile: ServerProfile | null
}
