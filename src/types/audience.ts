// CampaignAudience module — the canonical shape of "who a Campaign targets."
//
// Three views exist of an audience: the form input, the Prisma WHERE clause,
// and the display pills. They were previously duplicated across client + server.
// This module owns the shape and the pure transforms; the Prisma adapter lives
// in server/lib/audience-query.ts and consumes this same Audience type.

import {
  normalizeRoleFamily,
  labelForRoleFamily,
  type RoleFamily,
} from './roleFamilies.js'

export interface Audience {
  tags: string[]
  // Multi-select. Empty array means "no region filter" (any region).
  region: RegionFilter[]
  // Multi-select. Empty array means "no stage filter" (any stage).
  stage: string[]
  // Multi-select. Empty array means "no batch filter" (any batch).
  batch: string[]
  isHiring: boolean | null
  // Per-campaign override of the user's default target role. null means
  // "inherit the user's workspace default at apply time" — the wizard and
  // Apollo callers resolve the actual title set, not this field directly.
  targetRole: RoleFamily | null
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
  tags: [], region: [], stage: [], batch: [], isHiring: null, targetRole: null,
}

// Accept both the new array shape and the legacy scalar shape so a row written
// before the multi-select migration (or a client that hasn't redeployed yet)
// still round-trips correctly. Anything truthy becomes a 1-element array;
// null/undefined/'' becomes [].
function coerceFilterArray(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string' && v.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

// Build an Audience from raw Campaign fields stored in the DB / wire format.
// Keeps callers from having to know which fields are nullable how.
export function audienceFromCampaign(c: {
  filterTags?: string[] | null
  filterRegion?: string[] | string | null
  filterStage?: string[] | string | null
  filterBatch?: string[] | string | null
  filterIsHiring?: boolean | null
  filterTargetRole?: string | null
}): Audience {
  return {
    tags: c.filterTags ?? [],
    region: coerceFilterArray(c.filterRegion),
    stage: coerceFilterArray(c.filterStage),
    batch: coerceFilterArray(c.filterBatch),
    isHiring: c.filterIsHiring ?? null,
    // null fallback (not engineering default) when the campaign hasn't
    // specified a role — caller decides how to resolve "inherit user
    // default" vs "actually unset" at apply time.
    targetRole: normalizeRoleFamily(c.filterTargetRole, { fallback: null }),
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
    filterTargetRole: a.targetRole,
  }
}

// Display pills — short human labels for each active filter, ordered consistently.
// Each selected region/stage/batch emits its own pill so the user sees the
// full multi-select selection at a glance.
export function audienceToDisplayPills(a: Audience): string[] {
  return [
    ...a.tags.map(t => t.split(':')[1] ?? t),
    ...a.region.map(r => REGION_LABELS[r] ?? r),
    ...a.stage,
    ...a.batch,
    a.isHiring != null ? (a.isHiring ? 'Hiring' : 'Not hiring') : null,
    a.targetRole ? labelForRoleFamily(a.targetRole) : null,
  ].filter((v): v is string => Boolean(v))
}

// Whether the audience filters the company pool. targetRole is a
// contact-level filter (applied at Apollo searchContacts time), not a
// company-pool filter, so it intentionally doesn't count here.
export function isAudienceEmpty(a: Audience): boolean {
  return a.tags.length === 0
    && a.region.length === 0
    && a.stage.length === 0
    && a.batch.length === 0
    && a.isHiring == null
}
