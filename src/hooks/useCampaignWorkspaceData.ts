import { useMemo } from 'react'
import useSWR, { mutate } from 'swr'
import { apiGetAuth, fetchCampaignLeads, fetchEmails, fetchEmailsCombined } from '../lib/api'
import {
  readCampaignEmailsCache,
  readCampaignMembersCache,
  readDraftQueueCache,
  writeCampaignEmailsCache,
  writeCampaignMembersCache,
  writeDraftQueueCache,
} from '../lib/workspaceCache'
import type { DashboardEmailsResponse, Email, PageResponse } from '../types/api'

const DRAFT_QUEUE_LIMIT = 50

export const campaignMembersKey = (campaignId: string) => ['campaign-members', campaignId] as const
export const campaignEmailsKey = (campaignId: string) => ['campaign-emails', campaignId] as const
export const draftQueueKey = (userId: string | null | undefined, campaignId: string | null | undefined, tab: string) =>
  userId ? ['draft-queue', userId, campaignId || 'global', tab, DRAFT_QUEUE_LIMIT] as const : null

const swrOptions = {
  dedupingInterval: 10_000,
  focusThrottleInterval: 30_000,
  keepPreviousData: true,
}

// Sent emails are effectively immutable per row plus an append-on-send. The
// cross-region Vercel→Supabase call costs ~280ms+ and the list grows
// unboundedly, so re-fetching every time the user opens Sent is the most
// expensive idle work the app does. Cache for an hour within a session and
// skip focus-revalidation entirely. Mutations that change the sent set
// (markSent, delete) call invalidateSentQueue() to force a fresh read.
const sentSwrOptions = {
  ...swrOptions,
  dedupingInterval: 60 * 60 * 1000,
  revalidateOnFocus: false,
}

// Explicit invalidation for code paths that change the sent set — primarily
// markSent in DraftsTab. Re-fetches the sent queue for the given campaign.
export function invalidateSentQueue(userId: string | null | undefined, campaignId: string | null | undefined) {
  const key = draftQueueKey(userId, campaignId, 'sent')
  if (key) mutate(key)
}

async function fetchCampaignMembers(campaignId: string) {
  const data = await fetchCampaignLeads(campaignId)
  writeCampaignMembersCache(campaignId, data)
  return data
}

async function fetchCampaignEmails(campaignId: string) {
  const data = await fetchEmailsCombined({ campaignId })
  writeCampaignEmailsCache(campaignId, data)
  return data
}

async function fetchDraftQueue(userId: string, campaignId: string | null | undefined, tab: string) {
  const params: Record<string, unknown> = { status: tab, limit: String(DRAFT_QUEUE_LIMIT) }
  if (campaignId) params.campaignId = campaignId
  const data = await fetchEmails(params) as PageResponse<Email>
  writeDraftQueueCache(userId, tab, data.items || [], campaignId)
  return data
}

export function useCampaignMembers(campaignId: string) {
  const fallbackData = useMemo(() => readCampaignMembersCache(campaignId) ?? undefined, [campaignId])
  return useSWR(campaignMembersKey(campaignId), () => fetchCampaignMembers(campaignId), {
    ...swrOptions,
    fallbackData,
  })
}

export function useCampaignEmails(campaignId: string) {
  const fallbackData = useMemo(() => readCampaignEmailsCache(campaignId) ?? undefined, [campaignId])
  return useSWR<DashboardEmailsResponse>(campaignEmailsKey(campaignId), () => fetchCampaignEmails(campaignId), {
    ...swrOptions,
    fallbackData,
  })
}

export function useDraftQueue(userId: string | null | undefined, campaignId: string | null | undefined, tab: string) {
  const fallbackData = useMemo(() => {
    const items = readDraftQueueCache(userId, tab, campaignId)
    return items ? { items, nextCursor: null } as PageResponse<Email> : undefined
  }, [campaignId, tab, userId])
  return useSWR<PageResponse<Email>>(
    draftQueueKey(userId, campaignId, tab),
    () => fetchDraftQueue(userId!, campaignId, tab),
    {
      ...(tab === 'sent' ? sentSwrOptions : swrOptions),
      fallbackData,
    },
  )
}

export function prefetchCampaignWorkspace(campaignId: string) {
  const userId = apiGetAuth().userId
  mutate(campaignMembersKey(campaignId), fetchCampaignMembers(campaignId), { revalidate: false })
  mutate(campaignEmailsKey(campaignId), fetchCampaignEmails(campaignId), { revalidate: false })
  if (userId) {
    mutate(draftQueueKey(userId, campaignId, 'draft'), fetchDraftQueue(userId, campaignId, 'draft'), { revalidate: false })
    mutate(draftQueueKey(userId, campaignId, 'sent'), fetchDraftQueue(userId, campaignId, 'sent'), { revalidate: false })
  }
}

export { DRAFT_QUEUE_LIMIT }
