import { parseFlatDossier, type CompanyDossier } from './eng.js'
import { parseGtmDossier, type GtmDossier } from './gtm.js'
import { parseOpsDossier, type OpsDossier } from './ops.js'

// Multi-role cache envelope per ADR-0005. Each role family owns its own
// slot in the Company.researchDossier JSON column, and each slot carries
// its role-shaped dossier type. Product shares the engineering slot
// because they share the pipeline (see slotForRole below).

// Per-slot cached dossier — the per-role research output plus when it
// was produced. Lives inside the DossierEnvelope below. researchedAt
// is stored as ISO 8601 in JSON; we parse it back to Date at read time.
//
// Generic over the dossier type so engineering (CompanyDossier), GTM
// (GtmDossier), and ops (OpsDossier) slots can coexist in one envelope.
// Defaults to CompanyDossier for back-compat with callers that don't
// parameterize.
export interface CachedRoleSlot<TDossier = CompanyDossier> {
  dossier: TDossier
  researchedAt: Date
}

// Envelope shape stored in Company.researchDossier.
//
// Legacy flat rows (pre-ADR-0005) upgrade in-memory only — see
// parseCachedDossierEnvelope. There is no DB migration; the upgrade
// persists naturally the next time research re-runs and writes the
// envelope back.
export interface DossierEnvelope {
  engineering: CachedRoleSlot<CompanyDossier> | null
  gtm: CachedRoleSlot<GtmDossier> | null
  operations: CachedRoleSlot<OpsDossier> | null
}

const EMPTY_ENVELOPE: DossierEnvelope = Object.freeze({
  engineering: null,
  gtm: null,
  operations: null,
}) as DossierEnvelope

function parseEngSlot(value: unknown): CachedRoleSlot<CompanyDossier> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const dossier = parseFlatDossier(v.dossier)
  if (!dossier) return null
  const at = typeof v.researchedAt === 'string' ? new Date(v.researchedAt) : null
  if (!at || Number.isNaN(at.getTime())) return null
  return { dossier, researchedAt: at }
}

function parseGtmSlot(value: unknown): CachedRoleSlot<GtmDossier> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const dossier = parseGtmDossier(v.dossier)
  if (!dossier) return null
  const at = typeof v.researchedAt === 'string' ? new Date(v.researchedAt) : null
  if (!at || Number.isNaN(at.getTime())) return null
  return { dossier, researchedAt: at }
}

function parseOpsSlot(value: unknown): CachedRoleSlot<OpsDossier> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const dossier = parseOpsDossier(v.dossier)
  if (!dossier) return null
  const at = typeof v.researchedAt === 'string' ? new Date(v.researchedAt) : null
  if (!at || Number.isNaN(at.getTime())) return null
  return { dossier, researchedAt: at }
}

// Parses Company.researchDossier into an envelope, handling two shapes:
//   - Envelope (post-ADR-0005): { engineering, gtm, operations } JSON
//   - Legacy flat (pre-ADR-0005): the raw eng dossier JSON written directly
// Legacy rows fold into the `engineering` slot with `legacyAt` (which
// the caller passes as Company.researchedAt — the column that recorded
// when the flat dossier was last written). Invalid or missing values
// produce an empty envelope so callers can treat shape failures the
// same as a cache miss.
export function parseCachedDossierEnvelope(
  value: unknown,
  legacyAt: Date | null,
): DossierEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...EMPTY_ENVELOPE }
  }
  const v = value as Record<string, unknown>

  // Discriminator: prefer legacy when the JSON positively looks like a
  // flat dossier (has `summary` as string AND `surfaces` as array).
  // This is stronger than just checking absence of envelope keys — a
  // malformed legacy row with an incidental `engineering` field would
  // otherwise be misclassified as an envelope and silently produce a
  // cache miss. The two shapes are structurally exclusive in normal
  // use: legacy rows came from parseFlatDossier-conformant writes (no
  // envelope keys); envelope rows came from setDossierSlot writes (no
  // flat keys).
  const looksLikeLegacy =
    typeof v.summary === 'string' && Array.isArray(v.surfaces)
  if (looksLikeLegacy) {
    const legacy = parseFlatDossier(value)
    if (!legacy) return { ...EMPTY_ENVELOPE }
    return {
      engineering: { dossier: legacy, researchedAt: legacyAt ?? new Date(0) },
      gtm: null,
      operations: null,
    }
  }

  return {
    engineering: parseEngSlot(v.engineering),
    gtm: parseGtmSlot(v.gtm),
    operations: parseOpsSlot(v.operations),
  }
}

// Role → slot mapping. Product shares the engineering slot because
// they share the pipeline; null (no role resolved) also reads
// engineering by default.
type SlotRole = 'engineering' | 'gtm' | 'operations'
function slotForRole(role: 'engineering' | 'product' | 'gtm' | 'operations' | null): SlotRole {
  if (role === 'gtm') return 'gtm'
  if (role === 'operations') return 'operations'
  // engineering, product, null all read the eng slot
  return 'engineering'
}

// Overloaded so TS narrows the return type to the right dossier shape:
// engineering / product / null → CompanyDossier; gtm → GtmDossier;
// operations → OpsDossier.
export function getDossierSlot(
  envelope: DossierEnvelope,
  role: 'engineering' | 'product' | null,
): CachedRoleSlot<CompanyDossier> | null
export function getDossierSlot(
  envelope: DossierEnvelope,
  role: 'gtm',
): CachedRoleSlot<GtmDossier> | null
export function getDossierSlot(
  envelope: DossierEnvelope,
  role: 'operations',
): CachedRoleSlot<OpsDossier> | null
export function getDossierSlot(
  envelope: DossierEnvelope,
  role: 'engineering' | 'product' | 'gtm' | 'operations' | null,
): CachedRoleSlot<CompanyDossier> | CachedRoleSlot<GtmDossier> | CachedRoleSlot<OpsDossier> | null {
  return envelope[slotForRole(role)]
}

// Returns a new envelope with the target slot replaced. Pure — the
// input envelope is untouched. Used by the cache-write path so
// concurrent research for different roles can't wipe each other's
// slots.
//
// Overloaded so callers pass the right dossier shape for each role.
export function setDossierSlot(
  envelope: DossierEnvelope,
  role: 'engineering' | 'product' | null,
  slot: CachedRoleSlot<CompanyDossier>,
): DossierEnvelope
export function setDossierSlot(
  envelope: DossierEnvelope,
  role: 'gtm',
  slot: CachedRoleSlot<GtmDossier>,
): DossierEnvelope
export function setDossierSlot(
  envelope: DossierEnvelope,
  role: 'operations',
  slot: CachedRoleSlot<OpsDossier>,
): DossierEnvelope
export function setDossierSlot(
  envelope: DossierEnvelope,
  role: 'engineering' | 'product' | 'gtm' | 'operations' | null,
  slot: CachedRoleSlot<CompanyDossier> | CachedRoleSlot<GtmDossier> | CachedRoleSlot<OpsDossier>,
): DossierEnvelope {
  const key = slotForRole(role)
  return { ...envelope, [key]: slot }
}
