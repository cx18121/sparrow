import { fetchCompanies as apiFetchCompanies } from './api'
import type { CompanyListResponse } from '../types/api'

// Shared types + the campaign→discovery-filter mapping. Kept in lib (not in
// the LeadDiscoveryTab component) so non-UI modules (AuthContext, the unit
// test) can use it without pulling in React.

export type DiscoveryRegionFilter = 'us' | 'international' | 'remote' | null

// Campaign filter columns went multi-select (region/stage/batch are now
// string[]). The LeadDiscovery browse UI is still single-select, so we seed
// it with the first selected value of each — users can change it inside the
// tab. Anything beyond the first value is intentionally dropped here; the
// saved campaign filter remains the source of truth at generation time.
function firstFilterValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value.find((v): v is string => typeof v === 'string' && v.length > 0)
    return first ?? null
  }
  if (typeof value === 'string' && value.length > 0) return value
  return null
}

export function discoveryFiltersFromCampaign(campaignFilters: any): {
  selectedTags: string[]
  regionFilter: DiscoveryRegionFilter
  stageFilter: string | null
  batchFilter: string | null
  isHiring: boolean
} {
  const regionMap: Record<string, DiscoveryRegionFilter> = {
    __US__: 'us',
    __INTL__: 'international',
    __REMOTE__: 'remote',
  }
  const firstRegion = firstFilterValue(campaignFilters?.filterRegion)
  return {
    selectedTags: Array.isArray(campaignFilters?.filterTags) ? campaignFilters.filterTags : [],
    regionFilter: firstRegion ? (regionMap[firstRegion] ?? null) : null,
    stageFilter: firstFilterValue(campaignFilters?.filterStage),
    batchFilter: firstFilterValue(campaignFilters?.filterBatch),
    isHiring: campaignFilters?.filterIsHiring === true,
  }
}

// In-memory background prefetch of the first companies page for a campaign.
// WorkspaceShell calls prefetchLeadDiscovery() as soon as you enter any
// campaign sub-tab so navigating to Leads doesn't pay a round-trip. The
// companies endpoint is stateful (`random=true` records "seen" company IDs
// server-side), so we go out of our way to avoid firing duplicate requests:
//
//  - discoveryPrefetch     — in-flight promises keyed by campaign id, each
//                            tagged with a filter fingerprint so a settings
//                            edit replaces (rather than races) the old one.
//  - lastFetchedFingerprint — records "this campaign+filter combo has
//                            already been fetched (or consumed) in this
//                            session." Prevents WorkspaceShell from
//                            re-firing a background prefetch after the
//                            Leads tab has already handled the fetch
//                            itself, which previously caused two
//                            random=true calls on direct navigation and
//                            on post-consume re-renders.
const PREFETCH_PAGE_SIZE = 20
const MAX_PREFETCH_ENTRIES = 16

interface DiscoveryPrefetchEntry {
  key: string
  promise: Promise<CompanyListResponse>
  abort: () => void
}

const discoveryPrefetch = new Map<string, DiscoveryPrefetchEntry>()
const lastFetchedFingerprint = new Map<string, string>()

function discoveryPrefetchKey(filters: ReturnType<typeof discoveryFiltersFromCampaign>): string {
  return JSON.stringify({
    t: [...filters.selectedTags].sort(),
    r: filters.regionFilter,
    s: filters.stageFilter,
    b: filters.batchFilter,
    h: filters.isHiring,
  })
}

function evictOldestIfFull() {
  if (discoveryPrefetch.size < MAX_PREFETCH_ENTRIES) return
  // Map preserves insertion order — pop the oldest entry first.
  const oldestId = discoveryPrefetch.keys().next().value
  if (oldestId === undefined) return
  const entry = discoveryPrefetch.get(oldestId)
  entry?.abort()
  discoveryPrefetch.delete(oldestId)
}

export function prefetchLeadDiscovery(
  campaignId: string | null | undefined,
  campaignFilters: any,
): void {
  if (!campaignId) return
  const filters = discoveryFiltersFromCampaign(campaignFilters)
  const key = discoveryPrefetchKey(filters)

  // The Leads tab has already initiated a fetch for this combo (either by
  // consuming an earlier prefetch or by falling back to doSearch). Don't
  // burn another page of server-side "seen" state with a duplicate request.
  if (lastFetchedFingerprint.get(campaignId) === key) return

  const existing = discoveryPrefetch.get(campaignId)
  if (existing) {
    if (existing.key === key) return // identical prefetch already in flight/done
    // Filters changed — abandon the stale prefetch.
    existing.abort()
    discoveryPrefetch.delete(campaignId)
  }

  evictOldestIfFull()

  const params: Record<string, unknown> = { limit: PREFETCH_PAGE_SIZE, random: 'true' }
  if (filters.selectedTags.length > 0) params.tags = filters.selectedTags.join(',')
  if (filters.isHiring) params.isHiring = 'true'
  if (filters.regionFilter) params.regionType = filters.regionFilter
  if (filters.stageFilter) params.stage = filters.stageFilter
  if (filters.batchFilter) params.batch = filters.batchFilter

  const controller = new AbortController()
  const promise: Promise<CompanyListResponse> = apiFetchCompanies(params, {
    signal: controller.signal,
  }).catch(err => {
    const current = discoveryPrefetch.get(campaignId)
    if (current && current.promise === promise) discoveryPrefetch.delete(campaignId)
    throw err
  })
  discoveryPrefetch.set(campaignId, { key, promise, abort: () => controller.abort() })
}

export function consumeLeadDiscoveryPrefetch(
  campaignId: string,
  campaignFilters: any,
): Promise<CompanyListResponse> | null {
  const entry = discoveryPrefetch.get(campaignId)
  if (!entry) return null
  const filters = discoveryFiltersFromCampaign(campaignFilters)
  const key = discoveryPrefetchKey(filters)
  // Filter mismatch — fall back to a fresh fetch rather than flashing stale
  // results.
  if (entry.key !== key) return null
  discoveryPrefetch.delete(campaignId)
  lastFetchedFingerprint.set(campaignId, key)
  return entry.promise
}

// Called by LeadDiscoveryTab whenever it kicks off its own fetch (including
// the doSearch fallback when no prefetch was available). Lets WorkspaceShell's
// later prefetch effect notice "this combo is already handled, skip."
export function markLeadDiscoveryFetched(
  campaignId: string | null | undefined,
  campaignFilters: any,
): void {
  if (!campaignId) return
  const filters = discoveryFiltersFromCampaign(campaignFilters)
  lastFetchedFingerprint.set(campaignId, discoveryPrefetchKey(filters))
}

// Sign-out hook: drop all in-flight requests and any "already fetched"
// markers so the next user in this browser tab starts clean.
export function clearLeadDiscoveryPrefetch(): void {
  for (const entry of discoveryPrefetch.values()) entry.abort()
  discoveryPrefetch.clear()
  lastFetchedFingerprint.clear()
}
