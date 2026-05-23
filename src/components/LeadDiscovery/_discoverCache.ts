// Session-storage cache for the discover-state: scrollback position,
// selected tags, current page, etc. Keyed per-campaign because each
// campaign's discover view has independent state — switching campaigns
// shouldn't reset the active view.

const DISCOVER_CACHE_KEY = 'cf_discover_state'

function discoverCacheKey(campaignId?: string | null) {
  return campaignId ? `${DISCOVER_CACHE_KEY}:${campaignId}` : DISCOVER_CACHE_KEY
}

export function readDiscoverCache(campaignId?: string | null) {
  try { return JSON.parse(sessionStorage.getItem(discoverCacheKey(campaignId)) || 'null') } catch { return null }
}

export function writeDiscoverCache(state: object, campaignId?: string | null) {
  try { sessionStorage.setItem(discoverCacheKey(campaignId), JSON.stringify(state)) } catch {}
}

export function clearDiscoverCache(campaignId?: string | null) {
  try { sessionStorage.removeItem(discoverCacheKey(campaignId)) } catch {}
}
