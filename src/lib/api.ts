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

let currentUserId: string | null = null
let currentAccessToken: string | null = null
let explicitlySignedOut = false

export function setApiUserId(id: string | null) {
  currentUserId = id
  explicitlySignedOut = id === null
}
export function setApiAccessToken(token: string | null) { currentAccessToken = token }

export function apiGetAuth() {
  return { userId: currentUserId, accessToken: currentAccessToken }
}

// Decode a JWT's payload without verifying the signature — used only to
// check the `exp` claim so we can refresh before the server bounces a 401.
// 30s leeway covers minor clock skew and tokens that expire mid-flight
// between our check and the server's verification.
const EXPIRY_LEEWAY_MS = 30_000
function jwtExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + EXPIRY_LEEWAY_MS
  } catch {
    return false // unparseable (e.g. test tokens) — assume valid
  }
}

// Diagnostic state for the most recent refresh attempt — surfaced in 401
// error messages so the user can see WHY auth failed (refresh expired vs
// refresh succeeded but server still rejected vs network error).
type RefreshOutcome = {
  at: number
  ok: boolean
  source: 'storage' | 'refresh' | 'thrown' | 'no-session'
  errorCode?: string
  errorMessage?: string
  errorStatus?: number
}
let lastRefreshOutcome: RefreshOutcome | null = null

// Single-flight refresh: many parallel callers share one network refresh,
// avoiding the rotating-refresh-token race where the first call rotates the
// token and the rest get rejected.
let refreshPromise: Promise<string | null> | null = null

async function doRefresh(): Promise<string | null> {
  try {
    // Another tab may have already refreshed — check storage first so we
    // don't waste our refresh token on a redundant call.
    const { data: { session: stored } } = await supabase.auth.getSession()
    if (stored?.access_token && !jwtExpired(stored.access_token)) {
      currentUserId = stored.user?.id ?? currentUserId
      currentAccessToken = stored.access_token
      lastRefreshOutcome = { at: Date.now(), ok: true, source: 'storage' }
      return currentAccessToken
    }
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data.session) {
      currentAccessToken = null
      lastRefreshOutcome = {
        at: Date.now(),
        ok: false,
        source: error ? 'refresh' : 'no-session',
        errorCode: (error as any)?.code,
        errorMessage: error?.message,
        errorStatus: (error as any)?.status,
      }
      return null
    }
    currentUserId = data.session.user?.id ?? currentUserId
    currentAccessToken = data.session.access_token
    lastRefreshOutcome = { at: Date.now(), ok: true, source: 'refresh' }
    return currentAccessToken
  } catch (err: any) {
    lastRefreshOutcome = {
      at: Date.now(),
      ok: false,
      source: 'thrown',
      errorMessage: err?.message ?? String(err),
    }
    return null
  }
}

async function getAuthToken(): Promise<string | null> {
  if (explicitlySignedOut) return null
  if (currentAccessToken && !jwtExpired(currentAccessToken)) return currentAccessToken
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

// Dev diagnostic — call from console: window.__sparrowAuth()
export function getAuthDebug() {
  const expClaim = currentAccessToken ? jwtExpiryMs(currentAccessToken) : null
  return {
    userId: currentUserId,
    hasToken: !!currentAccessToken,
    tokenPreview: currentAccessToken ? `${currentAccessToken.slice(0, 24)}...` : null,
    tokenExpiresAt: expClaim ? new Date(expClaim).toISOString() : null,
    tokenExpiresInSec: expClaim ? Math.round((expClaim - Date.now()) / 1000) : null,
    explicitlySignedOut,
    refreshInFlight: !!refreshPromise,
    lastRefreshOutcome,
  }
}

function jwtExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch { return null }
}

// Expose on window for browser-console diagnostics (no-op in SSR/tests).
if (typeof window !== 'undefined') {
  (window as any).__sparrowAuth = getAuthDebug
}

function extractServerError(text) {
  if (!text) return ''
  try {
    const parsed = JSON.parse(text)
    // Auth-failure response from respondUnauthorized() — surface the rich
    // detail so the user sees "expired_token" or "user_not_found" instead of
    // just "Unauthorized".
    if (parsed?.error === 'Unauthorized' && parsed?.reason) {
      const parts = [`auth=${parsed.reason}`]
      if (parsed.supabaseCode) parts.push(`code=${parsed.supabaseCode}`)
      if (parsed.detail) parts.push(parsed.detail)
      return parts.join(' ')
    }
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

// Builds a specific 401 message from refresh state + server error body so the
// user can tell apart "your refresh token actually expired" from "server
// rejected a token we just refreshed successfully" — very different root causes.
function diagnose401(serverError: string): string {
  const last = lastRefreshOutcome
  const serverPart = serverError ? ` Server: "${serverError}".` : ''
  if (explicitlySignedOut) return 'You are signed out. Sign in to continue.' + serverPart
  if (!currentAccessToken && !last) {
    return 'No session. Sign in to continue.' + serverPart
  }
  if (last && !last.ok) {
    const detail = last.errorMessage ? `: ${last.errorMessage}` : ''
    const code = last.errorCode ? ` [${last.errorCode}]` : ''
    return `Session refresh failed${code}${detail}. Sign in again.` + serverPart
  }
  if (last && last.ok && last.source === 'refresh') {
    return 'Refreshed your session, but the server still rejected it. ' +
      'Likely the API server points at a different Supabase project ' +
      '(check SUPABASE_URL vs VITE_SUPABASE_URL).' + serverPart
  }
  if (last && last.ok && last.source === 'storage') {
    return 'Token from local storage was rejected by the server. ' +
      'Sign in again — your session may have been revoked.' + serverPart
  }
  return 'Sign in again to continue. Your session may have expired.' + serverPart
}

function friendlyApiMessage({ status, path, method, serverError }) {
  const normalized = `${serverError || ''}`.trim()
  const lower = normalized.toLowerCase()
  // If the server sent a specific, readable message (i.e. came from HttpError),
  // show it directly rather than replacing it with a hardcoded string — unless
  // the message is one of the known generic fallbacks below.
  const serverMessageIsSpecific = normalized && !GENERIC_SERVER_MESSAGES.has(lower)

  if (status === 401) return diagnose401(serverError)
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

async function request<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await getAuthToken()
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  })
  if (res.status === 204) return null
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

export const fetchCompanies = (params: Record<string, unknown> = {}, init?: RequestInit) =>
  request<CompanyListResponse>(`/companies${qs(params)}`, init)
export const resetDiscoverySeen = () => request<void>('/companies?seen=discovery', { method: 'DELETE' })

// `role` is the campaign's targetRole (or null to fall back to the user's
// workspace default at the server). Without this the server route can't
// know which role family the user is targeting and silently engineering
// titles are used regardless of campaign config — the refactor's primary
// goal would be broken end-to-end. See server/routes/apollo-search.ts.
export const apolloSearch = (domain: string, companyId: string, role: string | null = null) =>
  request<ApolloSearchResponse>('/apollo-search', {
    method: 'POST',
    body: JSON.stringify({ domain, companyId, role }),
  })

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
  // Active campaign context. When the user is generating a draft inside a
  // specific campaign, callers pass this so the server's role-aware
  // fit-angle uses the campaign's filterTargetRole instead of just the
  // workspace default. Standalone draft preview (no campaign) omits it.
  campaignId?: string | null;
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
export const changeEmailAngle = (emailId: string, featureLine: string | null) =>
  request<{ id: string; subject: string; body: string; featureLine: string | null; fitAngle: string | null }>(
    '/emails/angle',
    { method: 'POST', body: JSON.stringify({ emailId, featureLine }) }
  )
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
  return (async () => {
    // Always go through getAuthToken — using the cached currentAccessToken
    // directly would send an expired token and silently fail with 401.
    const authToken = await getAuthToken()
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
