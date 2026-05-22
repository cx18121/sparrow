// Server-side adapter for the CampaignAudience module.
// Translates an Audience into a Prisma WHERE clause for matching companies.
//
// The Audience shape itself lives in src/types/audience.ts so the front-end
// form, display pills, and this query builder can never disagree.

import { Prisma } from "@prisma/client";
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

// ─────────────────────────────────────────────────────────────
// Raw-SQL equivalent of audienceToPrismaWhere.
//
// Used by the discovery + audience-pool random selection paths so the
// anti-join + ORDER BY random() + LIMIT can happen inside Postgres in a
// single round-trip, instead of fetching every candidate ID into JS just
// to shuffle and pick N. See server/routes/companies.ts and
// server/lib/audience-pool.ts for the call sites.
//
// Returns an array of Prisma.Sql fragments meant to be joined with AND.
// All references use the `c.` table alias since the raw queries that
// consume these all alias Company as `c`.
//
// Pairs to audienceToPrismaWhere — any new audience field must be added
// to both. There's an audience-sql parity test that asserts the two
// builders produce semantically equivalent predicates over a fixture.
// ─────────────────────────────────────────────────────────────

interface SqlPredicateExtras {
  /** Optional industry filter — single value or list. */
  industries?: string[];
  /** Restrict to specific ingest sources (e.g. "yc", "a16z"). */
  sources?: string[];
  /** qualityScore >= minScore filter. */
  minScore?: number | null;
  /** name ILIKE startsWith search. */
  search?: string | null;
}

function arrayAnyPredicate(column: string, values: string[]): Prisma.Sql {
  // c."column" = ANY('{v1,v2,...}'::text[]) instead of WHERE col IN ($1,$2,…$N)
  // so Postgres parses one parameter instead of N. Matters when N is large
  // (e.g. 35 US regions in the region-IN clause).
  return Prisma.sql`${Prisma.raw(column)} = ANY(${values}::text[])`;
}

function arrayNotAnyPredicate(column: string, values: string[]): Prisma.Sql {
  return Prisma.sql`${Prisma.raw(column)} != ALL(${values}::text[])`;
}

function regionSqlFragmentsFor(region: string): Prisma.Sql[] {
  if (region === REGION_US) return [arrayAnyPredicate('c."region"', [...US_REGIONS])];
  if (region === REGION_INTL) {
    return [
      Prisma.sql`c."region" IS NOT NULL`,
      arrayNotAnyPredicate('c."region"', [...US_REGIONS, "Remote"]),
    ];
  }
  if (region === REGION_REMOTE) return [Prisma.sql`c."region" = 'Remote'`];
  return [Prisma.sql`c."region" = ${region}`];
}

export function audienceToSqlPredicates(a: Audience, extras: SqlPredicateExtras = {}): Prisma.Sql[] {
  const predicates: Prisma.Sql[] = [Prisma.sql`c."isVerified" = true`];

  // Tags: AND across namespaces, OR within (matches buildTagFilters above).
  const byNs: Record<string, string[]> = {};
  for (const t of a.tags) {
    const idx = t.indexOf(":");
    const ns = idx > 0 ? t.slice(0, idx) : "_";
    (byNs[ns] ??= []).push(t);
  }
  for (const group of Object.values(byNs)) {
    // c.tags && ARRAY['vertical:fintech', 'vertical:saas']::text[]
    // The GIN index on tags (Company_tags_idx) accelerates this overlap op.
    predicates.push(Prisma.sql`c.tags && ${group}::text[]`);
  }

  // Region: single → flat; multi → OR over each region's fragments.
  if (a.region.length === 1) {
    const frags = regionSqlFragmentsFor(a.region[0]);
    for (const f of frags) predicates.push(f);
  } else if (a.region.length > 1) {
    // Each region produces 1-2 AND'd fragments. Build OR of those AND blocks.
    const orBlocks = a.region.map(r => {
      const frags = regionSqlFragmentsFor(r);
      return frags.length === 1 ? frags[0] : Prisma.sql`(${Prisma.join(frags, " AND ")})`;
    });
    predicates.push(Prisma.sql`(${Prisma.join(orBlocks, " OR ")})`);
  }

  // Stage (ordinal-aware expansion mirrors audienceToPrismaWhere).
  if (a.stage.length > 0) {
    const expanded = Array.from(new Set(a.stage.flatMap(s => expandStageFilter(s))));
    if (expanded.length === 1) {
      predicates.push(Prisma.sql`c."stage" = ${expanded[0]}`);
    } else {
      predicates.push(arrayAnyPredicate('c."stage"', expanded));
    }
  }

  // Batch
  if (a.batch.length === 1) {
    predicates.push(Prisma.sql`c."batch" = ${a.batch[0]}`);
  } else if (a.batch.length > 1) {
    predicates.push(arrayAnyPredicate('c."batch"', a.batch));
  }

  if (a.isHiring != null) {
    predicates.push(Prisma.sql`c."isHiring" = ${a.isHiring}`);
  }

  // Extras (mirrors baseWhere assembly in server/routes/companies.ts).
  if (extras.industries && extras.industries.length === 1) {
    predicates.push(Prisma.sql`c."industry" = ${extras.industries[0]}`);
  } else if (extras.industries && extras.industries.length > 1) {
    predicates.push(arrayAnyPredicate('c."industry"', extras.industries));
  }
  if (extras.sources && extras.sources.length > 0) {
    predicates.push(arrayAnyPredicate('c."source"', extras.sources));
  }
  if (extras.minScore != null) {
    predicates.push(Prisma.sql`c."qualityScore" >= ${extras.minScore}`);
  }
  if (extras.search) {
    // startsWith + mode: insensitive → ILIKE 'search%'
    // Concat via Postgres so the search term stays parameterized.
    predicates.push(Prisma.sql`c."name" ILIKE ${extras.search + "%"}`);
  }

  return predicates;
}
