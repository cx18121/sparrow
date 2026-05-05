import { isDemo, supabase } from './supabase'
import type {
  Campaign, CampaignOptions, CompanyListResponse, CustomContact,
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
    if (lower.includes('claude api key') || lower.includes('anthropic') || lower.includes('email generation is not configured')) {
      return 'Email generation is not configured on this deployment.'
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

  if (path === '/google/connect') {
    if (status === 404) return 'Gmail connection endpoint is not reachable. Make sure the API server is running (npm run dev:api or vercel dev) or redeploy.'
    if (status === 500) return serverError || 'Gmail connection could not start. Verify GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set on the server.'
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

export const fetchCompanies = (params: Record<string, unknown> = {}) =>
  request<CompanyListResponse>(`/companies${qs(params)}`)
export const resetDiscoverySeen = () => request<void>('/companies?seen=discovery', { method: 'DELETE' })

export const apolloSearch = (domain: string, companyId: string) =>
  request<ApolloSearchResponse>('/apollo-search', { method: 'POST', body: JSON.stringify({ domain, companyId }) })

export const revealApolloContact = (personId: string, companyId: string, domain: string) =>
  request<ApolloRevealResponse>('/apollo-search', { method: 'PUT', body: JSON.stringify({ personId, companyId, domain }) })

export const fetchCustomContacts = () => request<PageResponse<CustomContact>>('/custom-contacts')
export const createCustomContact = (data: {
  name?: string | null
  email?: string | null
  title?: string | null
  companyName?: string | null
  campaignId?: string
}) =>
  request<CustomContact & { campaignCustomContactId?: string }>('/custom-contacts', {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const fetchLeads = (params: Record<string, unknown> = {}) =>
  request<PageResponse<UserLead>>(`/leads${qs(params)}`)
export const saveLead = (data: { companyId: string; contactId?: string | null; apolloPersonId?: string | null; notes?: string | null }) =>
  request<UserLead>('/leads', { method: 'POST', body: JSON.stringify(data) })
export const updateLead = (data: { id: string; status?: string; notes?: string | null }) =>
  request<UserLead>('/leads', { method: 'PATCH', body: JSON.stringify(data) })
export const deleteLead = (id: string) => request<void>(`/leads${qs({ id })}`, { method: 'DELETE' })

export const fetchPreviewFitAngle = (resumeText: string) =>
  request<{ featureLine: string | null; fitAngle: string | null }>('/preview/fit-angle', {
    method: 'POST',
    body: JSON.stringify({ resumeText }),
  })

export const fetchEmails = (params: Record<string, unknown> = {}) =>
  request<PageResponse<Email>>(`/emails${qs(params)}`)
export const fetchEmailsCombined = (params: { campaignId?: string } = {}) =>
  request<DashboardEmailsResponse>(`/emails${qs({ combined: 'true', ...params })}`)
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
export const sendEmail = (emailId: string) =>
  request<SendEmailResponse>('/emails/send', { method: 'POST', body: JSON.stringify({ emailId }) })
export const sendTestEmail = (emailId: string, recipient: string) =>
  request<{ success: true; recipient: string }>('/emails/send-test', {
    method: 'POST',
    body: JSON.stringify({ emailId, recipient }),
  })
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

export const fetchCampaignOptions = () => request<CampaignOptions>('/campaign-options')

export const queryAudience = (
  audience: import('../types/audience').Audience,
  excludePreviouslySaved = true,
) =>
  request<{ count: number; sample: string[] }>('/audience-query', {
    method: 'POST',
    body: JSON.stringify({ audience, excludePreviouslySaved }),
  })

export interface CampaignMembers {
  items: UserLead[]
  customContacts: Array<CustomContact & { campaignCustomContactId: string; emails?: Array<{ id: string; subject: string | null; status: string }> }>
}
export const fetchCampaignLeads = (campaignId: string) =>
  request<CampaignMembers>(`/campaign-leads${qs({ campaignId })}`)
export const addCampaignLead = (campaignId: string, userLeadId: string) =>
  request<UserLead>('/campaign-leads', { method: 'POST', body: JSON.stringify({ campaignId, userLeadId }) })
export const removeCampaignLead = (campaignLeadId: string) =>
  request<void>(`/campaign-leads${qs({ id: campaignLeadId })}`, { method: 'DELETE' })
export const removeCampaignCustomContact = (campaignCustomContactId: string) =>
  request<void>(`/campaign-leads${qs({ id: campaignCustomContactId, kind: 'custom-contact' })}`, { method: 'DELETE' })

export function deleteAccount() {
  const tokenAtClick = currentAccessToken
  return (async () => {
    if (!tokenAtClick) await ensureApiAuth()
    const authToken = tokenAtClick ?? currentAccessToken
    const res = await fetch(`${BASE}/account`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    })
    if (!res.ok) {
      const text = await res.text()
      const serverError = extractServerError(text || res.statusText)
      const message = friendlyApiMessage({
        status: res.status,
        path: '/account',
        method: 'DELETE',
        serverError,
      })
      throw Object.assign(new Error(message), {
        status: res.status,
        path: '/account',
        method: 'DELETE',
        serverError,
        rawBody: text,
      })
    }
    return res.status === 204 ? null : res.json()
  })()
}
