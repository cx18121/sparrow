// Role-family taxonomy for targeting startup contacts via Apollo.
//
// "Target role" is a per-campaign filter (with a per-user default) controlling
// which contact titles searchContacts looks up at each company. Universal
// titles (Founder/Co-Founder/CEO) are merged into every selection so small
// startups without a function-specific lead in Apollo (Head of Design, VP
// Sales, etc.) still resolve to a decision-maker.

export type RoleFamily =
  | 'engineering'
  | 'product'
  | 'sales'
  | 'marketing'
  | 'operations'
  | 'recruiting'

export interface RoleFamilyDef {
  id: RoleFamily
  label: string
  // Apollo's person_titles matches loosely on these (partial, case-insensitive),
  // so we keep canonical forms here and rely on Apollo's matching for variants.
  apolloTitles: string[]
}

// Universal decision-maker titles. Merged into every role selection so the
// CEO/Founder safety net is always part of the Apollo query.
export const UNIVERSAL_TITLES: string[] = [
  'Founder',
  'Co-Founder',
  'CEO',
]

export const ROLE_FAMILIES: RoleFamilyDef[] = [
  {
    id: 'engineering',
    label: 'Engineering',
    apolloTitles: [
      'CTO',
      'VP Engineering',
      'Head of Engineering',
      'Engineering Manager',
    ],
  },
  {
    id: 'product',
    label: 'Product & Design',
    apolloTitles: [
      'CPO',
      'Head of Product',
      'VP Product',
      'Head of Design',
      'Chief Design Officer',
    ],
  },
  {
    id: 'sales',
    label: 'Sales & GTM',
    apolloTitles: [
      'Head of Sales',
      'VP Sales',
      'Chief Revenue Officer',
      'Head of GTM',
      'Head of Business Development',
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing & Growth',
    apolloTitles: [
      'Head of Marketing',
      'VP Marketing',
      'CMO',
      'Head of Growth',
      'Head of Content',
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    apolloTitles: [
      'COO',
      'Head of Operations',
      'CFO',
      'Chief of Staff',
      'Head of BizOps',
    ],
  },
  {
    id: 'recruiting',
    label: 'People & Recruiting',
    apolloTitles: [
      'Head of People',
      'Head of Talent',
      'VP People',
      'Head of Recruiting',
    ],
  },
]

const ROLE_FAMILY_BY_ID = Object.fromEntries(
  ROLE_FAMILIES.map(r => [r.id, r])
) as Record<RoleFamily, RoleFamilyDef>

// Default selection for new users / new campaigns when nothing else is set.
// Matches the pre-refactor TARGET_TITLES behavior (CTO/Founder/CEO-leaning).
export const DEFAULT_ROLE_FAMILIES: RoleFamily[] = ['engineering']

// Hard cap on roles per campaign — see roleFamilies discussion in
// docs/agents/. Picking too many de-targets Apollo and dilutes fit-angle.
export const MAX_ROLES_PER_CAMPAIGN = 3

export function isRoleFamily(value: unknown): value is RoleFamily {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLE_FAMILY_BY_ID, value)
}

// Normalize a string[] from DB / wire / form state to a clean RoleFamily[].
// Filters unknown ids, dedupes, enforces the cap. Empty input → fallback.
// Callers pass `{ fallback: [] }` when they want to distinguish "unset"
// from "use the default" (e.g. wizard inheriting from workspace config).
export function normalizeRoleFamilies(
  raw: unknown,
  options: { fallback?: RoleFamily[] } = {}
): RoleFamily[] {
  const fallback = options.fallback ?? DEFAULT_ROLE_FAMILIES
  if (!Array.isArray(raw)) return [...fallback]
  const seen = new Set<RoleFamily>()
  for (const item of raw) {
    if (isRoleFamily(item)) seen.add(item)
    if (seen.size >= MAX_ROLES_PER_CAMPAIGN) break
  }
  if (seen.size === 0) return [...fallback]
  return [...seen]
}

// Returns the union of Apollo titles for the given roles plus UNIVERSAL_TITLES.
// Deduped. Used by server/lib/apollo.ts:searchContacts to scope person_titles.
// Empty `roles` falls back to UNIVERSAL_TITLES alone so no caller breaks if
// they pass `[]`.
export function titlesForRoles(roles: readonly RoleFamily[]): string[] {
  const out = new Set<string>(UNIVERSAL_TITLES)
  for (const r of roles) {
    const def = ROLE_FAMILY_BY_ID[r]
    if (!def) continue
    for (const t of def.apolloTitles) out.add(t)
  }
  return [...out]
}

export function labelForRoleFamily(id: RoleFamily): string {
  return ROLE_FAMILY_BY_ID[id]?.label ?? id
}
