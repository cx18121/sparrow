import { isDemo, supabase } from './supabase'

const BASE = '/api'

let currentUserId = null
let currentAccessToken = null

export function setApiUserId(id) { currentUserId = id }
export function setApiAccessToken(token) { currentAccessToken = token }

export function apiGetAuth() {
  return { userId: currentUserId, accessToken: currentAccessToken }
}

async function ensureApiAuth() {
  if (currentAccessToken || isDemo) return
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
    if (status === 404) return 'We could not find that contact. Refresh Contacts and try again.'
  }

  if (path === '/apollo-search' || path === '/leads') {
    if (lower.includes('apollo') || lower.includes('api key')) {
      return 'Lead search is not configured yet. Add or check the Apollo key before searching contacts.'
    }
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

async function request(path, opts = {}, retrying = false) {
  await ensureApiAuth()
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(currentUserId ? { 'x-user-id': currentUserId } : {}),
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

function qs(params) {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString()
  return s ? `?${s}` : ''
}

export const fetchHealth = () => request('/health')

export const fetchCompanies = (params = {}) => request(`/companies${qs(params)}`)
export const resetDiscoverySeen = () => request('/companies?seen=discovery', { method: 'DELETE' })
export const fetchIndustries = () => request('/industries')

export const apolloSearch = (domain, companyId) =>
  request('/apollo-search', { method: 'POST', body: JSON.stringify({ domain, companyId }) })

export const revealApolloContact = (personId) =>
  request('/apollo-search', { method: 'PUT', body: JSON.stringify({ personId }) })

export const fetchContacts = (params = {}) => request(`/contacts${qs(params)}`)

export const fetchCustomContacts = () => request('/custom-contacts')
export const createCustomContact = (data) =>
  request('/custom-contacts', { method: 'POST', body: JSON.stringify(data) })
export const deleteCustomContact = (id) =>
  request(`/custom-contacts${qs({ id })}`, { method: 'DELETE' })

export const fetchLeads = (params = {}) => request(`/leads${qs(params)}`)
export const saveLead = (data) =>
  request('/leads', { method: 'POST', body: JSON.stringify(data) })
export const updateLead = (data) =>
  request('/leads', { method: 'PATCH', body: JSON.stringify(data) })
export const deleteLead = (id) => request(`/leads${qs({ id })}`, { method: 'DELETE' })

export const fetchEmails = (params = {}) => request(`/emails${qs(params)}`)
export const createEmail = (data) =>
  request('/emails', { method: 'POST', body: JSON.stringify(data) })
export const updateEmail = (data) =>
  request('/emails', { method: 'PATCH', body: JSON.stringify(data) })
export const generateEmail = (data) =>
  request('/emails/generate', { method: 'POST', body: JSON.stringify(data) })
export const sendEmail = (emailId, options = {}) =>
  request('/emails/send', { method: 'POST', body: JSON.stringify({ emailId, ...options }) })

export const fetchProfile = () => request('/profile')
export const saveProfile = (data) =>
  request('/profile', { method: 'POST', body: JSON.stringify(data) })
export const connectGoogle = (returnTo) =>
  request('/google/connect', { method: 'POST', body: JSON.stringify({ returnTo }) })

export const fetchTemplates = () => request('/templates')
export const createTemplate = (data) =>
  request('/templates', { method: 'POST', body: JSON.stringify(data) })
export const updateTemplate = (data) =>
  request('/templates', { method: 'PATCH', body: JSON.stringify(data) })
export const deleteTemplate = (id) =>
  request(`/templates${qs({ id })}`, { method: 'DELETE' })

export const fetchCampaigns = (params = {}) => request(`/campaigns${qs(params)}`)
export const createCampaign = (data) =>
  request('/campaigns', { method: 'POST', body: JSON.stringify(data) })
export const updateCampaign = (data) =>
  request('/campaigns', { method: 'PATCH', body: JSON.stringify(data) })
export const deleteCampaign = (id) =>
  request(`/campaigns${qs({ id })}`, { method: 'DELETE' })

export const fetchCampaignBatch = (campaignId) =>
  request(`/campaign-batch${qs({ campaignId })}`)
export const generateCampaignBatch = (campaignId) =>
  request('/campaign-batch', { method: 'POST', body: JSON.stringify({ campaignId }) })
export const resetCampaignSeen = (campaignId) =>
  request(`/campaign-batch${qs({ campaignId })}`, { method: 'DELETE' })
export const fetchCampaignOptions = () => request('/campaign-options')
export const fetchCampaignLeads = (campaignId) =>
  request(`/campaign-leads${qs({ campaignId })}`)
export const addCampaignLead = (campaignId, userLeadId) =>
  request('/campaign-leads', { method: 'POST', body: JSON.stringify({ campaignId, userLeadId }) })
export const deleteCampaignLead = (id) =>
  request(`/campaign-leads${qs({ id })}`, { method: 'DELETE' })
