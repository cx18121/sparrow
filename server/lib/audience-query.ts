// Server-side adapter for the CampaignAudience module.
// Translates an Audience into a Prisma WHERE clause for matching companies.
//
// The Audience shape itself lives in src/types/audience.ts so the front-end
// form, display pills, and this query builder can never disagree.

import { US_REGIONS } from "../../scripts/_lib/region-map.js";
import { expandStageFilter } from "../../scripts/_lib/stages.js";
import {
  REGION_INTL, REGION_REMOTE, REGION_US, type Audience,
} from "../../src/types/audience.js";
import { normalizeRoleFamily } from "../../src/types/roleFamilies.js";

// Older callsites pass the raw Campaign filter* fields. Convert in-place.
// region/stage/batch accept both the new array shape and the legacy scalar
// shape so a row written before the multi-select migration still works.
export interface CampaignFilters {
  filterTags?: string[] | null;
  filterRegion?: string[] | string | null;
  filterStage?: string[] | string | null;
  filterBatch?: string[] | string | null;
  filterIsHiring?: boolean | null;
  filterTargetRole?: string | null;
}

function coerceFilterArray(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

export function audienceFromCampaign(c: CampaignFilters): Audience {
  return {
    tags: c.filterTags ?? [],
    region: coerceFilterArray(c.filterRegion),
    stage: coerceFilterArray(c.filterStage),
    batch: coerceFilterArray(c.filterBatch),
    isHiring: c.filterIsHiring ?? null,
    targetRole: normalizeRoleFamily(c.filterTargetRole, { fallback: null }),
  };
}

// Group a flat tag list by namespace prefix for AND-across-namespaces /
// OR-within-namespace selection logic. Exported for use by company-selection.ts
// and by tests that verify tag grouping independently.
export function buildTagFilters(tags: string[]) {
  const byNs: Record<string, string[]> = {};
  for (const t of tags) {
    const idx = t.indexOf(":");
    const ns = idx > 0 ? t.slice(0, idx) : "_";
    (byNs[ns] ??= []).push(t);
  }
  return Object.values(byNs).map(group => ({ tags: { hasSome: group } }));
}

// Build the OR'd region clause for a single selected region value. Returned
// as a Prisma WHERE fragment that can be OR'd with siblings.
function regionClauseFor(region: string): Record<string, unknown> {
  if (region === REGION_US) return { region: { in: [...US_REGIONS] } };
  if (region === REGION_INTL) {
    // Intl = "has a region AND it's not a US region AND it's not Remote."
    return {
      AND: [
        { region: { not: null } },
        { region: { notIn: [...US_REGIONS, "Remote"] } },
      ],
    };
  }
  if (region === REGION_REMOTE) return { region: "Remote" };
  return { region };
}

export function audienceToPrismaWhere(a: Audience) {
  const tagFilters = buildTagFilters(a.tags);
  const andConditions: Array<Record<string, unknown>> = [...tagFilters];
  let regionWhere: Record<string, unknown> = {};

  // Region: empty = no filter; single = flat clause at the WHERE root (keeps
  // a simple shape for callers/tests that read `where.region` directly);
  // multi = OR'd clauses appended to AND so any selected region matches.
  if (a.region.length === 1) {
    const clause = regionClauseFor(a.region[0]);
    // Intl returns a nested AND; everything else is a single region key.
    // Either shape spreads cleanly at the root.
    if ("AND" in clause && Array.isArray(clause.AND)) {
      andConditions.push(...(clause.AND as Array<Record<string, unknown>>));
    } else {
      regionWhere = clause;
    }
  } else if (a.region.length > 1) {
    andConditions.push({ OR: a.region.map(regionClauseFor) });
  }

  // Stage filter is ordinal-aware: a "+"-suffix value (e.g. "Series C+")
  // expands to the set of stages at or beyond that ordinal so granular
  // Series C / D / E rows surface alongside the legacy C+ aggregation
  // bucket. Exact-stage filters (no "+") fall through as single-value
  // matches. See scripts/_lib/stages.ts for the expansion rules. Multi-select
  // unions every selected stage's expansion.
  let stageWhere: Record<string, unknown> = {};
  if (a.stage.length > 0) {
    const expanded = Array.from(
      new Set(a.stage.flatMap(s => expandStageFilter(s))),
    );
    stageWhere = { stage: expanded.length === 1 ? expanded[0] : { in: expanded } };
  }

  // Batch: empty = no filter; single = equality; multiple = IN.
  let batchWhere: Record<string, unknown> = {};
  if (a.batch.length === 1) {
    batchWhere = { batch: a.batch[0] };
  } else if (a.batch.length > 1) {
    batchWhere = { batch: { in: a.batch } };
  }

  return {
    isVerified: true,
    ...(andConditions.length > 0 && { AND: andConditions }),
    ...regionWhere,
    ...stageWhere,
    ...batchWhere,
    ...(a.isHiring != null && { isHiring: a.isHiring }),
  };
}
