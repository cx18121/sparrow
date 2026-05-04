// Server-side adapter for the CampaignAudience module.
// Translates an Audience into a Prisma WHERE clause for matching companies.
//
// The Audience shape itself lives in src/types/audience.ts so the front-end
// form, display pills, and this query builder can never disagree.

import { US_REGIONS } from "../../scripts/_lib/region-map.js";
import {
  REGION_INTL, REGION_REMOTE, REGION_US, type Audience,
} from "../../src/types/audience.js";

// Older callsites pass the raw Campaign filter* fields. Convert in-place.
export interface CampaignFilters {
  filterTags?: string[] | null;
  filterRegion?: string | null;
  filterStage?: string | null;
  filterBatch?: string | null;
  filterIsHiring?: boolean | null;
  filterHeadcountMin?: number | null;
  filterHeadcountMax?: number | null;
}

export function audienceFromCampaign(c: CampaignFilters): Audience {
  return {
    tags: c.filterTags ?? [],
    region: c.filterRegion ?? null,
    stage: c.filterStage ?? null,
    batch: c.filterBatch ?? null,
    isHiring: c.filterIsHiring ?? null,
  };
}

// Group a flat tag list by namespace prefix for AND-across-namespaces /
// OR-within-namespace selection logic. Exported so the existing
// campaign-batch-service test surface stays addressable.
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

  return {
    isVerified: true,
    ...(andConditions.length > 0 && { AND: andConditions }),
    ...regionWhere,
    ...(a.stage && { stage: a.stage }),
    ...(a.batch && { batch: a.batch }),
    ...(a.isHiring != null && { isHiring: a.isHiring }),
  };
}
