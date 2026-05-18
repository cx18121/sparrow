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
import { normalizeRoleFamilies } from "../../src/types/roleFamilies.js";

// Older callsites pass the raw Campaign filter* fields. Convert in-place.
export interface CampaignFilters {
  filterTags?: string[] | null;
  filterRegion?: string | null;
  filterStage?: string | null;
  filterBatch?: string | null;
  filterIsHiring?: boolean | null;
  filterTargetRoles?: string[] | null;
}

export function audienceFromCampaign(c: CampaignFilters): Audience {
  return {
    tags: c.filterTags ?? [],
    region: c.filterRegion ?? null,
    stage: c.filterStage ?? null,
    batch: c.filterBatch ?? null,
    isHiring: c.filterIsHiring ?? null,
    targetRoles: normalizeRoleFamilies(c.filterTargetRoles, { fallback: [] }),
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

export function audienceToPrismaWhere(a: Audience) {
  const tagFilters = buildTagFilters(a.tags);
  const andConditions: Array<Record<string, unknown>> = [...tagFilters];
  let regionWhere: Record<string, unknown> = {};

  if (a.region === REGION_US) {
    regionWhere = { region: { in: [...US_REGIONS] } };
  } else if (a.region === REGION_INTL) {
    andConditions.push({ region: { not: null } });
    andConditions.push({ region: { notIn: [...US_REGIONS, "Remote"] } });
  } else if (a.region === REGION_REMOTE) {
    regionWhere = { region: "Remote" };
  } else if (a.region) {
    regionWhere = { region: a.region };
  }

  // Stage filter is ordinal-aware: a "+"-suffix value (e.g. "Series C+")
  // expands to the set of stages at or beyond that ordinal so granular
  // Series C / D / E rows surface alongside the legacy C+ aggregation
  // bucket. Exact-stage filters (no "+") fall through as single-value
  // matches. See scripts/_lib/stages.ts for the expansion rules.
  const stageWhere = a.stage
    ? (() => {
        const expanded = expandStageFilter(a.stage);
        return { stage: expanded.length === 1 ? expanded[0] : { in: expanded } };
      })()
    : {};

  return {
    isVerified: true,
    ...(andConditions.length > 0 && { AND: andConditions }),
    ...regionWhere,
    ...stageWhere,
    ...(a.batch && { batch: a.batch }),
    ...(a.isHiring != null && { isHiring: a.isHiring }),
  };
}
