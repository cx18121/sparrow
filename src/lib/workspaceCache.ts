import type { CampaignMembers } from './api'
import type { DashboardEmailsResponse, Email } from '../types/api'

type CachePayload<T> = {
  cachedAt: string
  data: T
}

function readCache<T>(key: string): T | null {
  try {
    const payload = JSON.parse(localStorage.getItem(key) || 'null') as CachePayload<T> | null
    return payload?.data ?? null
  } catch {
    return null
  }
}

function writeCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ cachedAt: new Date().toISOString(), data }))
  } catch {
    // Cache writes should never block the primary workspace action.
  }
}

export function draftQueueCacheKey(userId: string | null | undefined, tab: string, campaignId?: string | null) {
  if (!userId) return null
  const scope = campaignId ? `campaign_${campaignId}` : 'global'
  return `cf_email_cache_${userId}_${scope}_${tab}`
}

export function readDraftQueueCache(userId: string | null | undefined, tab: string, campaignId?: string | null): Email[] | null {
  const key = draftQueueCacheKey(userId, tab, campaignId)
  return key ? readCache<Email[]>(key) : null
}

export function writeDraftQueueCache(userId: string | null | undefined, tab: string, items: Email[], campaignId?: string | null) {
  const key = draftQueueCacheKey(userId, tab, campaignId)
  if (key) writeCache(key, items)
}

export function readCampaignMembersCache(campaignId: string) {
  return readCache<CampaignMembers>(`cf_campaign_members_${campaignId}`)
}

export function writeCampaignMembersCache(campaignId: string, data: CampaignMembers) {
  writeCache(`cf_campaign_members_${campaignId}`, data)
}

export function readCampaignEmailsCache(campaignId: string) {
  return readCache<DashboardEmailsResponse>(`cf_campaign_emails_${campaignId}`)
}

export function writeCampaignEmailsCache(campaignId: string, data: DashboardEmailsResponse) {
  writeCache(`cf_campaign_emails_${campaignId}`, data)
}
