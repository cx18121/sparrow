// CampaignAudience module — the canonical shape of "who a Campaign targets."
//
// Three views exist of an audience: the form input, the Prisma WHERE clause,
// and the display pills. They were previously duplicated across client + server.
// This module owns the shape and the pure transforms; the Prisma adapter lives
// in server/lib/audience-query.ts and consumes this same Audience type.

import {
  normalizeRoleFamilies,
  labelForRoleFamily,
  type RoleFamily,
} from './roleFamilies'

export interface Audience {
  tags: string[]
  region: RegionFilter | null
  stage: string | null
  batch: string | null
  isHiring: boolean | null
  // Per-campaign override of the user's default target roles. Empty array
  // means "inherit the user's workspace default at apply time" — the wizard
  // and Apollo callers resolve the actual title set, not this field directly.
  targetRoles: RoleFamily[]
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
  tags: [], region: null, stage: null, batch: null, isHiring: null, targetRoles: [],
}

// Build an Audience from raw Campaign fields stored in the DB / wire format.
// Keeps callers from having to know which fields are nullable how.
export function audienceFromCampaign(c: {
  filterTags?: string[] | null
  filterRegion?: string | null
  filterStage?: string | null
  filterBatch?: string | null
  filterIsHiring?: boolean | null
  filterTargetRoles?: string[] | null
}): Audience {
  return {
    tags: c.filterTags ?? [],
    region: c.filterRegion ?? null,
    stage: c.filterStage ?? null,
    batch: c.filterBatch ?? null,
    isHiring: c.filterIsHiring ?? null,
    // Empty array (not the default-engineering fallback) when the campaign
    // hasn't specified roles — caller decides how to resolve "inherit user
    // default" vs "actually empty" at apply time.
    targetRoles: normalizeRoleFamilies(c.filterTargetRoles, { fallback: [] }),
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
    filterTargetRoles: a.targetRoles,
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
    ...a.targetRoles.map(labelForRoleFamily),
  ].filter((v): v is string => Boolean(v))
}

// Whether the audience filters the company pool. Target roles are a
// contact-level filter (applied at Apollo searchContacts time), not a
// company-pool filter, so they intentionally don't count here.
export function isAudienceEmpty(a: Audience): boolean {
  return a.tags.length === 0 && !a.region && !a.stage && !a.batch && a.isHiring == null
}
