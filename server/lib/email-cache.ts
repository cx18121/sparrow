const DASHBOARD_CACHE_TTL = 30_000;
const MAX_DASHBOARD_CACHE_ENTRIES = 500;
const DASHBOARD_CACHE_EVICT_COUNT = 100;

declare global {
  var __dashCache: Map<string, { data: unknown; ts: number }> | undefined;
}

function dashboardCache() {
  globalThis.__dashCache ??= new Map();
  return globalThis.__dashCache;
}

export function emailDashboardCacheKey(userId: string, campaignId?: string | null) {
  return campaignId ? `${userId}:campaign:${campaignId}` : `${userId}:global`;
}

export function getEmailDashboardCache(key: string) {
  const entry = dashboardCache().get(key);
  if (!entry || Date.now() - entry.ts > DASHBOARD_CACHE_TTL) return null;
  return entry.data;
}

export function setEmailDashboardCache(key: string, data: unknown) {
  const cache = dashboardCache();
  cache.set(key, { data, ts: Date.now() });

  if (cache.size > MAX_DASHBOARD_CACHE_ENTRIES) {
    const oldest = [...cache.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, DASHBOARD_CACHE_EVICT_COUNT);
    oldest.forEach(([oldKey]) => cache.delete(oldKey));
  }
}

export function invalidateEmailDashboardCache(userId: string) {
  const prefix = `${userId}:`;
  for (const key of dashboardCache().keys()) {
    if (key.startsWith(prefix)) dashboardCache().delete(key);
  }
}
