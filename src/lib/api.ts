import { supabase } from './supabase'
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

// Decode a JWT's payload without verifying the signature — used only to
// check the `exp` claim so we can proactively refresh before sending a
// request that would otherwise bounce with 401.
function jwtExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()
  } catch {
    return false // don't block on parse failure
  }
}

async function ensureApiAuth() {
  if (explicitlySignedOut) return
  // Proactively refresh if the stored token is expired rather than waiting
  // for the server to bounce it with 401 — avoids the extra round-trip.
  if (currentAccessToken && !jwtExpired(currentAccessToken)) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  currentUserId = session.user?.id ?? currentUserId
  currentAccessToken = session.access_token ?? currentAccessToken
}

async function refreshApiAuth() {
  try {
    // Supabase's auto-refresh timer may have already renewed the session.
    // Check the stored session first to avoid racing with the internal refresh
    // (rotating refresh tokens: if Supabase rotated the token a moment ago, a
    // manual refreshSession() with the old token would fail).
    const { data: { session: stored } } = await supabase.auth.getSession()
    if (stored?.access_token && !jwtExpired(stored.access_token)) {
      currentUserId = stored.user?.id ?? null
      currentAccessToken = stored.access_token
      return true
    }

    // Token still stale — do a hard network refresh.
    const { data, error } = await supabase.auth.refreshSession()
    const session = error ? null : data?.session
    if (!session) {
      currentUserId = null
      currentAccessToken = null
      // A non-zero HTTP status means Supabase Auth rejected the refresh
      // (expired or revoked token) — this is a genuine auth failure, not a
      // transient network blip. Sign out so the auth screen surfaces.
      // AuthRetryableFetchError has no status; that case stays in the catch.
      if (error?.status) supabase.auth.signOut().catch(() => {})
      return false
    }
    currentUserId = session.user?.id ?? null
    currentAccessToken = session.access_token ?? null
    return Boolean(currentAccessToken)
  } catch {
    // Network error during refresh — don't sign out, just report failure.
    return false
  }
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

// Messages that are too generic to show directly to users — fall back to
// path-specific guidance or the generic 500 message instead.
const GENERIC_SERVER_MESSAGES = new Set([
  'internal server error',
  'an unexpected error occurred',
  'something went wrong',
])

function friendlyApiMessage({ status, path, method, serverError }) {
  const normalized = `${serverError || ''}`.trim()
  const lower = normalized.toLowerCase()
  // If the server sent a specific, readable message (i.e. came from HttpError),
  // show it directly rather than replacing it with a hardcoded string — unless
  // the message is one of the known generic fallbacks below.
  const serverMessageIsSpecific = normalized && !GENERIC_SERVER_MESSAGES.has(lower)

  if (status === 401) return 'Sign in again to continue. Your session may have expired.'
  if (status === 403) return 'You do not have access to this item.'

  if (path === '/emails/send') {
    if (status === 429) return serverError || 'Daily send limit reached for today.'
    if (status === 404) return 'We could not find that draft. Refresh and try again.'
    if (lower.includes('already been sent')) return 'This email was already sent.'
    if (lower.includes('already being sent')) return 'This email is currently being sent. Refresh and try again.'
    if (lower.includes('gmail not connected') || lower.includes('connect gmail')) {
      return 'Gmail is not connected. Go to Settings → Account to reconnect.'
    }
    if (lower.includes('reconnect google') || lower.includes('google connection')) {
      return 'Your Google connection needs to be refreshed. Go to Settings → Account to reconnect.'
    }
    if (lower.includes('recipient') || lower.includes('no recipient')) {
      return 'No recipient email address on this draft. Add a contact before sending.'
    }
    if (lower.includes('gmail') || status === 502) {
      return 'Gmail failed to send this email. Try reconnecting Gmail in Settings → Account.'
    }
    if (lower.includes('attachment')) return normalized
    if (serverMessageIsSpecific) return normalized
    return 'Send failed. Check that Gmail is connected in Settings → Account and try again.'
  }

  if (path === '/emails/generate') {
    if (lower.includes('claude api key') || lower.includes('anthropic') || lower.includes('email generation is not configured')) {
      return 'Email generation is not configured on this deployment.'
    }
    if (status === 404 && lower.includes('template')) return 'The selected template no longer exists. Choose a different template and try again.'
    if (status === 404) return 'Lead not found — it may have been removed. Refresh and try again.'
    if (lower.includes('no contact')) return 'No contact email found for this lead. Save a contact from Discover first.'
    if (serverMessageIsSpecific) return normalized
  }

  if (path === '/apollo-search' || path === '/leads') {
    if (lower.includes('apollo_api_key') || lower.includes('apollo api key') || lower.includes('apollo key')) {
      return 'Lead search is not configured. Add or check the Apollo key in your environment.'
    }
    if (lower.includes('rate limit') || status === 429) return 'Apollo rate limit reached. Wait a moment and try again.'
    if (serverMessageIsSpecific) return normalized
  }

  if (path === '/profile') {
    if (method === 'GET') return 'Could not load your settings. Refresh or sign in again.'
    if (serverMessageIsSpecific) return normalized
    return 'Settings could not be saved. Try again.'
  }

  if (path === '/google/connect') {
    if (status === 404) return 'Gmail connection endpoint is not reachable. Check that your API server is running.'
    if (serverMessageIsSpecific) return normalized
    return 'Gmail connection could not start. Verify GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.'
  }

  if (status === 404) return 'We could not find what you asked for. Refresh and try again.'
  if (status === 429) return 'Too many requests. Wait a moment and try again.'
  // Show the server's specific message if it's readable; only fall back to the
  // generic phrasing when the server gave us nothing useful.
  if (serverMessageIsSpecific) return normalized
  if (status >= 500) return 'Something went wrong on the server. Try again in a moment.'

  return `Request failed${method ? ` while trying to ${method.toLowerCase()}` : ''}. Try again.`
}

async function request<T = unknown>(path: string, opts: RequestInit = {}, retrying = false): Promise<T> {
  await ensureApiAuth()
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : {}),
      ...(opts.headers || {}),
    },
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
  attachmentIds?: string[];
  interestHook?: string | null; extraContext?: string | null;
  includeResumeBullet?: boolean; save?: boolean;
}, idempotencyKey?: string) => request<GenerateEmailResponse>('/emails/generate', {
  method: 'POST',
  ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  body: JSON.stringify(data),
})
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
