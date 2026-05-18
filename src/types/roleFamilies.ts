// Role-family taxonomy for targeting startup contacts via Apollo.
//
// Each campaign targets exactly one role family. The family controls which
// Apollo person_titles get queried at each company. Universal titles
// (Founder/Co-Founder/CEO) are merged into every family so small startups
// without a function-specific lead in Apollo still resolve to a
// decision-maker.
//
// Four families — collapsed from the earlier 6 because the email-generation
// strategy doesn't meaningfully differ between Sales vs Marketing or
// between Operations vs People for a job-seeker pitch. The buckets mirror
// how startups think about their org chart: build (Eng), build-what
// (Product/Design), grow (GTM), run (Ops + Finance + People).

export type RoleFamily =
  | 'engineering'
  | 'product'
  | 'gtm'
  | 'operations'

export interface RoleFamilyDef {
  id: RoleFamily
  label: string
  // Apollo's person_titles matches loosely on these (partial, case-insensitive),
  // so we keep canonical forms here and rely on Apollo's matching for variants.
  apolloTitles: string[]
}

// Universal decision-maker titles. Merged into every family's resolved set so
// the CEO/Founder safety net is always part of the Apollo query — preserves
// the pre-refactor TARGET_TITLES safety behavior across all roles.
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
    id: 'gtm',
    label: 'GTM',
    apolloTitles: [
      'Head of Sales',
      'VP Sales',
      'Chief Revenue Officer',
      'CMO',
      'Head of Marketing',
      'VP Marketing',
      'Head of Growth',
      'Head of Business Development',
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    apolloTitles: [
      'COO',
      'CFO',
      'Head of Operations',
      'Chief of Staff',
      'Head of People',
      'Head of Talent',
      'Head of BizOps',
    ],
  },
]

const ROLE_FAMILY_BY_ID = Object.fromEntries(
  ROLE_FAMILIES.map(r => [r.id, r])
) as Record<RoleFamily, RoleFamilyDef>

// Default selection for new users / new campaigns when nothing else is set.
// Matches the pre-refactor TARGET_TITLES (engineering-leaning) baseline so
// existing users see no behavior change until they pick a different family.
export const DEFAULT_ROLE_FAMILY: RoleFamily = 'engineering'

export function isRoleFamily(value: unknown): value is RoleFamily {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLE_FAMILY_BY_ID, value)
}

// Normalize a value from DB / wire / form state to a clean RoleFamily | null.
// Unknown ids return the fallback. Pass `{ fallback: null }` when callers
// want to distinguish "explicitly empty" from "use the default" (e.g. wizard
// inheriting from workspace config; campaigns with no override row).
export function normalizeRoleFamily(
  raw: unknown,
  options: { fallback?: RoleFamily | null } = {}
): RoleFamily | null {
  const fallback = options.fallback === undefined ? DEFAULT_ROLE_FAMILY : options.fallback
  if (isRoleFamily(raw)) return raw
  return fallback
}

// Returns the Apollo titles for one role plus UNIVERSAL_TITLES. Deduped.
// Used by server/lib/apollo.ts:searchContacts to scope person_titles.
// Passing null falls back to UNIVERSAL_TITLES alone — useful for callers
// who want the safety-net-only query (e.g. broad "any decision-maker"
// discovery scripts).
export function titlesForRole(role: RoleFamily | null): string[] {
  const out = new Set<string>(UNIVERSAL_TITLES)
  if (role) {
    const def = ROLE_FAMILY_BY_ID[role]
    if (def) for (const t of def.apolloTitles) out.add(t)
  }
  return [...out]
}

export function labelForRoleFamily(id: RoleFamily): string {
  return ROLE_FAMILY_BY_ID[id]?.label ?? id
}
