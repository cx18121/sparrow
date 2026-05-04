import { isDemo, supabase } from './supabase'
import type {
  Campaign, CampaignBatchResponse, CampaignOptions, CompanyListResponse, CustomContact,
  DashboardEmailsResponse, Email, GenerateEmailResponse, PageResponse, SendEmailResponse,
  SentTodayCountResponse, Template, UserLead,
  ApolloSearchResponse, ApolloRevealResponse,
} from '../types/api'
import type { UiCampaign } from '../contexts/AppDataContext'

const BASE = '/api'

// Wire format uses uppercase enum (DRAFT|ACTIVE|PAUSED|COMPLETED).
// UI format uses lowercase. The conversion is sealed inside this file —
// the rest of the app never sees the wire format.
function wireToUi(c: Campaign): UiCampaign {
  return { ...c, status: (c.status || 'DRAFT').toLowerCase() as UiCampaign['status'] }
}
function uiToWire<T extends { status?: string }>(data: T): T {
  if (!data?.status) return data
  return { ...data, status: data.status.toUpperCase() as Campaign['status'] }
}

let currentUserId = null
let currentAccessToken = null
let explicitlySignedOut = false

export function setApiUserId(id) {
  currentUserId = id
  if (id === null) explicitlySignedOut = true
  else explicitlySignedOut = false
}
export function setApiAccessToken(token) { currentAccessToken = token }

export function apiGetAuth() {
  return { userId: currentUserId, accessToken: currentAccessToken }
}

async function ensureApiAuth() {
  if (currentAccessToken || isDemo) return
  // Never restore from a Supabase session after an explicit sign-out —
  // doing so would re-populate a signed-out user's token for a brief window
  // while supabase.auth.signOut() is still in flight.
  if (explicitlySignedOut) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  currentUserId = session.user?.id ?? currentUserId
  currentAccessToken = session.access_token ?? currentAccessToken
}

async function refreshApiAuth() {
  if (isDemo) return false
  const { data, error } = await supabase.auth.refreshSession()
  const session = error ? null : data?.session
  if (!session) {
    currentUserId = null
    currentAccessToken = null
    return false
  }
  currentUserId = session.user?.id ?? null
  currentAccessToken = session.access_token ?? null
  return Boolean(currentAccessToken)
}

function extractServerError(text) {
  if (!text) return ''
  try {
    const parsed = JSON.parse(text)
    return parsed?.error || parsed?.message || text
  } catch {
    return text
  }
}

function friendlyApiMessage({ status, path, method, serverError }) {
  const normalized = `${serverError || ''}`.trim()
  const lower = normalized.toLowerCase()

  if (status === 401) return 'Sign in again to continue. Your session may have expired.'
  if (status === 403) return 'You do not have access to this item.'

  if (path === '/emails/send') {
    if (status === 429) return serverError || 'Daily send limit reached for today.'
    if (status === 404) return 'We could not find that draft. Refresh Drafts and try again.'
    if (lower.includes('gmail not connected') || lower.includes('connect gmail')) {
      return 'Connect Gmail in Settings before sending email.'
    }
    if (lower.includes('recipient')) return 'Add a recipient email address before sending this draft.'
    if (lower.includes('gmail') || status === 502) {
      return 'Gmail could not send this email. Check that Gmail API is enabled in Google Cloud, then reconnect Google in Settings.'
    }
  }

  if (path === '/emails/generate') {
    if (lower.includes('claude api key') || lower.includes('anthropic')) {
      return 'Add a Claude API key in Settings before generating emails.'
    }
    if (status === 404 && lower.includes('template')) return 'The selected template no longer exists. Choose a different template and try again.'
    if (status === 404) return 'Lead not found — it may have been removed. Refresh the page and try again.'
    if (status === 400 && lower.includes('no contact')) return 'No contact email found for this lead. Save a contact from Discover first.'
  }

  if (path === '/apollo-search' || path === '/leads') {
    if (lower.includes('apollo_api_key') || lower.includes('apollo api key') || lower.includes('apollo key')) {
      return 'Lead search is not configured yet. Add or check the Apollo key before searching contacts.'
    }
    if (lower.includes('rate limit') || status === 429) return 'Apollo rate limit reached. Wait a moment and try again.'
    if (lower.includes('apollo api error') || lower.includes('apollo search failed')) return serverError || 'Apollo search failed. Try again.'
  }

  if (path === '/profile') {
    if (method === 'GET') return 'We could not load your setup status. Refresh Settings or sign in again.'
    return 'Settings could not be saved. Check that all required environment variables are set, then try again.'
  }

  if (status === 404) return 'We could not find what you asked for. Refresh the page and try again.'
  if (status === 429) return 'Too many requests at once. Wait a minute, then try again.'
  if (status >= 500) return 'The server could not finish that request. Try again in a moment.'
  if (normalized) return normalized

  return `Request failed${method ? ` while trying to ${method.toLowerCase()}` : ''}. Try again.`
}

async function request<T = unknown>(path: string, opts: RequestInit = {}, retrying = false): Promise<T> {
  await ensureApiAuth()
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : {}),
      ...(opts.headers || {}),
    },
    ...opts,
  })
  if (res.status === 204) return null
  if (res.status === 401 && !retrying && await refreshApiAuth()) {
    return request(path, opts, true)
  }
  if (!res.ok) {
    const text = await res.text()
    const method = opts.method || 'GET'
    const serverError = extractServerError(text || res.statusText)
    const message = friendlyApiMessage({ status: res.status, path, method, serverError })
    throw Object.assign(new Error(message), {
      status: res.status,
      path,
      method,
      serverError,
      rawBody: text,
    })
  }
  return res.json()
}

function qs(params: Record<string, unknown>) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '') as [string, string][]
  const s = new URLSearchParams(entries).toString()
  return s ? `?${s}` : ''
}

export const fetchHealth = () => request<{ ok: true }>('/health')

export const fetchCompanies = (params: Record<string, unknown> = {}) =>
  request<CompanyListResponse>(`/companies${qs(params)}`)
export const resetDiscoverySeen = () => request<void>('/companies?seen=discovery', { method: 'DELETE' })
export const fetchIndustries = () => request<{ items: string[] }>('/industries')

export const apolloSearch = (domain: string, companyId: string) =>
  request<ApolloSearchResponse>('/apollo-search', { method: 'POST', body: JSON.stringify({ domain, companyId }) })

export const revealApolloContact = (personId: string, companyId: string, domain: string) =>
  request<ApolloRevealResponse>('/apollo-search', { method: 'PUT', body: JSON.stringify({ personId, companyId, domain }) })

export const fetchContacts = (params: Record<string, unknown> = {}) =>
  request<PageResponse<UserLead>>(`/contacts${qs(params)}`)

export const fetchCustomContacts = () => request<PageResponse<CustomContact>>('/custom-contacts')
export const createCustomContact = (data: Partial<CustomContact>) =>
  request<CustomContact>('/custom-contacts', { method: 'POST', body: JSON.stringify(data) })
export const updateCustomContact = (data: Partial<CustomContact> & { id: string }) =>
  request<CustomContact>('/custom-contacts', { method: 'PATCH', body: JSON.stringify(data) })
export const deleteCustomContact = (id: string) =>
  request<void>(`/custom-contacts${qs({ id })}`, { method: 'DELETE' })

export const fetchLeads = (params: Record<string, unknown> = {}) =>
  request<PageResponse<UserLead>>(`/leads${qs(params)}`)
export const saveLead = (data: { companyId: string; contactId?: string | null; apolloPersonId?: string | null; notes?: string | null }) =>
  request<UserLead>('/leads', { method: 'POST', body: JSON.stringify(data) })
export const updateLead = (data: { id: string; status?: string; notes?: string | null }) =>
  request<UserLead>('/leads', { method: 'PATCH', body: JSON.stringify(data) })
export const deleteLead = (id: string) => request<void>(`/leads${qs({ id })}`, { method: 'DELETE' })

export const fetchEmails = (params: Record<string, unknown> = {}) =>
  request<PageResponse<Email>>(`/emails${qs(params)}`)
export const fetchEmailsCombined = () =>
  request<DashboardEmailsResponse>(`/emails${qs({ combined: 'true' })}`)
export const fetchSentTodayCount = () => request<SentTodayCountResponse>('/emails?countToday=true')
export const createEmail = (data: Partial<Email> & { userLeadId?: string; customContactId?: string }) =>
  request<Email>('/emails', { method: 'POST', body: JSON.stringify(data) })
export const updateEmail = (data: Partial<Email> & { id: string }) =>
  request<Email>('/emails', { method: 'PATCH', body: JSON.stringify(data) })
export const generateEmail = (data: {
  userLeadId?: string; customContactId?: string;
  templateId?: string | null; tone?: string;
  interestHook?: string | null; extraContext?: string | null;
  includeResumeBullet?: boolean; save?: boolean;
}) => request<GenerateEmailResponse>('/emails/generate', { method: 'POST', body: JSON.stringify(data) })
export const generateStyleGuide = (examples: string[]) =>
  request<{ guide: string }>('/style-guide', { method: 'POST', body: JSON.stringify({ examples }) })
export const sendEmail = (emailId: string) =>
  request<SendEmailResponse>('/emails/send', { method: 'POST', body: JSON.stringify({ emailId }) })
export const deleteEmails = (ids: string[]) =>
  request<{ deleted: string[] }>(`/emails${qs({ ids: ids.join(',') })}`, { method: 'DELETE' })
export const updateEmailAttachments = (id: string, attachmentIds: string[]) =>
  request<Email>('/emails', { method: 'PATCH', body: JSON.stringify({ id, attachmentIds }) })

export const fetchProfile = () => request<{ profile: any }>('/profile')
export const saveProfile = (data: Record<string, unknown>) =>
  request<{ profile: any }>('/profile', { method: 'POST', body: JSON.stringify(data) })
export const connectGoogle = (returnTo: string) =>
  request<{ url: string }>('/google/connect', { method: 'POST', body: JSON.stringify({ returnTo }) })

export const fetchTemplates = () => request<PageResponse<Template>>('/templates')
export const createTemplate = (data: Partial<Template>) =>
  request<Template>('/templates', { method: 'POST', body: JSON.stringify(data) })
export const updateTemplate = (data: Partial<Template> & { id: string }) =>
  request<Template>('/templates', { method: 'PATCH', body: JSON.stringify(data) })
export const deleteTemplate = (id: string) =>
  request<void>(`/templates${qs({ id })}`, { method: 'DELETE' })

export const fetchCampaigns = async (params: Record<string, unknown> = {}): Promise<PageResponse<UiCampaign>> => {
  const res = await request<PageResponse<Campaign>>(`/campaigns${qs(params)}`)
  return { ...res, items: (res.items || []).map(wireToUi) }
}
export const createCampaign = async (data: Partial<UiCampaign>): Promise<UiCampaign> => {
  const wire = await request<Campaign>('/campaigns', { method: 'POST', body: JSON.stringify(uiToWire(data)) })
  return wireToUi(wire)
}
export const updateCampaign = async (data: Partial<UiCampaign> & { id: string }): Promise<UiCampaign> => {
  const wire = await request<Campaign>('/campaigns', { method: 'PATCH', body: JSON.stringify(uiToWire(data)) })
  return wireToUi(wire)
}
export const deleteCampaign = (id: string) =>
  request<void>(`/campaigns${qs({ id })}`, { method: 'DELETE' })

export const fetchCampaignBatch = (campaignId: string) =>
  request<CampaignBatchResponse>(`/campaign-batch${qs({ campaignId })}`)
export const generateCampaignBatch = (campaignId: string) =>
  request<CampaignBatchResponse>('/campaign-batch', { method: 'POST', body: JSON.stringify({ campaignId }) })
export const resetCampaignSeen = (campaignId: string) =>
  request<{ reset: true }>(`/campaign-batch${qs({ campaignId })}`, { method: 'DELETE' })
export const fetchCampaignOptions = () => request<CampaignOptions>('/campaign-options')

export const queryAudience = (
  audience: import('../types/audience').Audience,
  excludePreviouslySaved = true,
) =>
  request<{ count: number; sample: string[] }>('/audience-query', {
    method: 'POST',
    body: JSON.stringify({ audience, excludePreviouslySaved }),
  })

export const fetchCampaignLeads = (campaignId: string) =>
  request<PageResponse<UserLead>>(`/campaign-leads${qs({ campaignId })}`)
export const addCampaignLead = (campaignId: string, userLeadId: string) =>
  request<UserLead>('/campaign-leads', { method: 'POST', body: JSON.stringify({ campaignId, userLeadId }) })
export const deleteCampaignLead = (id: string) =>
  request<void>(`/campaign-leads${qs({ id })}`, { method: 'DELETE' })

export const deleteAccount = () => request<void>('/account', { method: 'DELETE' })
