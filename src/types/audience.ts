// CampaignAudience module — the canonical shape of "who a Campaign targets."
//
// Three views exist of an audience: the form input, the Prisma WHERE clause,
// and the display pills. They were previously duplicated across client + server.
// This module owns the shape and the pure transforms; the Prisma adapter lives
// in server/lib/audience-query.ts and consumes this same Audience type.

export interface Audience {
  tags: string[]
  region: RegionFilter | null
  stage: string | null
  batch: string | null
  isHiring: boolean | null
}

// Region special values. Plain region strings (e.g. "Europe") also accepted.
export const REGION_US = '__US__'
export const REGION_INTL = '__INTL__'
export const REGION_REMOTE = '__REMOTE__'
export type RegionFilter = typeof REGION_US | typeof REGION_INTL | typeof REGION_REMOTE | string

const REGION_LABELS: Record<string, string> = {
  [REGION_US]: 'US companies',
  [REGION_INTL]: 'International',
  [REGION_REMOTE]: 'Remote',
}

export const EMPTY_AUDIENCE: Audience = {
  tags: [], region: null, stage: null, batch: null, isHiring: null,
}

// Build an Audience from raw Campaign fields stored in the DB / wire format.
// Keeps callers from having to know which fields are nullable how.
export function audienceFromCampaign(c: {
  filterTags?: string[] | null
  filterRegion?: string | null
  filterStage?: string | null
  filterBatch?: string | null
  filterIsHiring?: boolean | null
}): Audience {
  return {
    tags: c.filterTags ?? [],
    region: c.filterRegion ?? null,
    stage: c.filterStage ?? null,
    batch: c.filterBatch ?? null,
    isHiring: c.filterIsHiring ?? null,
  }
}

// Inverse: serialize an Audience to the wire-format filter* fields.
export function audienceToCampaignFields(a: Audience) {
  return {
    filterTags: a.tags,
    filterRegion: a.region,
    filterStage: a.stage,
    filterBatch: a.batch,
    filterIsHiring: a.isHiring,
  }
}

// Display pills — short human labels for each active filter, ordered consistently.
export function audienceToDisplayPills(a: Audience): string[] {
  return [
    ...a.tags.map(t => t.split(':')[1] ?? t),
    a.region ? (REGION_LABELS[a.region] ?? a.region) : null,
    a.stage,
    a.batch,
    a.isHiring != null ? (a.isHiring ? 'Hiring' : 'Not hiring') : null,
  ].filter((v): v is string => Boolean(v))
}

export function isAudienceEmpty(a: Audience): boolean {
  return a.tags.length === 0 && !a.region && !a.stage && !a.batch && a.isHiring == null
}
