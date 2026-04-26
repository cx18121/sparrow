const BASE = '/api'

let currentUserId = null
let currentAccessToken = null

export function setApiUserId(id) { currentUserId = id }
export function setApiAccessToken(token) { currentAccessToken = token }

export function apiGetAuth() {
  return { userId: currentUserId, accessToken: currentAccessToken }
}

async function request(path, opts = {}) {
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
  if (!res.ok) {
    const text = await res.text()
    throw Object.assign(new Error(`API ${res.status}: ${text || res.statusText}`), { status: res.status, path, method: opts.method || 'GET' })
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

export const fetchProfile = () => request('/profile')
export const saveProfile = (data) =>
  request('/profile', { method: 'POST', body: JSON.stringify(data) })

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
