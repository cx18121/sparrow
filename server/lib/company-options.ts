import { prisma } from "./prisma.js";
import { CANONICAL_TAG_GROUPS, TAG_NAMESPACES } from "../../scripts/_lib/tags.js";
import { mergeStages } from "../../scripts/_lib/stages.js";
import { US_REGIONS } from "../../scripts/_lib/region-map.js";

// Shape of the data /api/campaign-options returns. Kept here so the
// endpoint, the precompute script, and any future consumers all use the
// same shape — the JSON in CompanyOptionsSnapshot.payload conforms to
// this type and the endpoint casts the JSONB column to it on read.

interface TagFacet {
  name: string;       // e.g. "fintech"
  count: number;      // companies with this tag
  namespaced: string; // full "vertical:fintech" form for filter param
}

export interface CompanyOptionsPayload {
  industries: string[];
  regions: string[];
  stages: string[];
  batches: string[];
  sources: string[];
  tags: Record<string, TagFacet[]>;
  canonicalTags: typeof CANONICAL_TAG_GROUPS;
  tagNamespaces: typeof TAG_NAMESPACES;
  hiringCount: number;
  usCount: number;
  intlCount: number;
  remoteCount: number;
}

const SNAPSHOT_ID = "singleton";

// Compute the payload by running the 10 parallel aggregations against
// Company. This is the expensive path — used by refreshCompanyOptionsSnapshot
// (deliberately, on ingest completion) and by the endpoint's fallback when
// no snapshot row exists yet.
export async function computeCompanyOptionsPayload(): Promise<CompanyOptionsPayload> {
  const usRegions = [...US_REGIONS];
  const [industries, regions, stages, batches, sources, tagRows, hiringCount, usCount, intlCount, remoteCount] = await Promise.all([
    prisma.company.findMany({
      where: { isVerified: true, industry: { not: null } },
      distinct: ["industry"],
      select: { industry: true },
      orderBy: { industry: "asc" },
    }),
    prisma.company.findMany({
      where: { isVerified: true, region: { not: null } },
      distinct: ["region"],
      select: { region: true },
      orderBy: { region: "asc" },
    }),
    prisma.company.findMany({
      where: { isVerified: true, stage: { not: null } },
      distinct: ["stage"],
      select: { stage: true },
      orderBy: { stage: "asc" },
    }),
    prisma.company.findMany({
      where: { isVerified: true, batch: { not: null } },
      distinct: ["batch"],
      select: { batch: true },
      orderBy: { batch: "desc" },
    }),
    prisma.company.findMany({
      where: { isVerified: true },
      distinct: ["source"],
      select: { source: true },
      orderBy: { source: "asc" },
    }),
    prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
      SELECT unnest(tags) AS tag, COUNT(*)::bigint AS count
      FROM "Company"
      WHERE "isVerified" = true
      GROUP BY tag
      ORDER BY count DESC, tag ASC
    `,
    prisma.company.count({ where: { isVerified: true, isHiring: true } }),
    prisma.company.count({ where: { isVerified: true, region: { in: usRegions } } }),
    prisma.company.count({ where: { isVerified: true, region: { not: null, notIn: [...usRegions, "Remote"] } } }),
    prisma.company.count({ where: { isVerified: true, region: "Remote" } }),
  ]);

  // Bucket realized tags by namespace prefix. Anything without a colon
  // (legacy / unrecognized) lands under "_".
  const realized: Record<string, TagFacet[]> = {};
  for (const r of tagRows) {
    const idx = r.tag.indexOf(":");
    const ns = idx > 0 ? r.tag.slice(0, idx) : "_";
    const name = idx > 0 ? r.tag.slice(idx + 1) : r.tag;
    (realized[ns] ??= []).push({
      name,
      count: Number(r.count),
      namespaced: r.tag,
    });
  }

  return {
    industries: industries.map(c => c.industry).filter(Boolean) as string[],
    regions: regions.map(c => c.region).filter(Boolean) as string[],
    // Union DB-realized stages with the canonical vocabulary so the wizard
    // surfaces Series C / D / E etc. as filter chips even before the DB
    // accumulates rows in those buckets.
    stages: mergeStages(stages.map(c => c.stage).filter(Boolean) as string[]),
    batches: batches.map(c => c.batch).filter(Boolean) as string[],
    sources: sources.map(c => c.source),
    tags: realized,
    canonicalTags: CANONICAL_TAG_GROUPS,
    tagNamespaces: TAG_NAMESPACES,
    hiringCount,
    usCount,
    intlCount,
    remoteCount,
  };
}

// Refresh the singleton row in CompanyOptionsSnapshot.
// Returns the payload so callers (e.g. the endpoint's fallback path) can
// also use the just-computed value without a second DB read.
export async function refreshCompanyOptionsSnapshot(): Promise<CompanyOptionsPayload> {
  const payload = await computeCompanyOptionsPayload();
  await prisma.companyOptionsSnapshot.upsert({
    where: { id: SNAPSHOT_ID },
    create: { id: SNAPSHOT_ID, payload: payload as unknown as object },
    update: { payload: payload as unknown as object },
  });
  return payload;
}

// Read the latest snapshot, or null if none exists yet (fresh deploy).
export async function readCompanyOptionsSnapshot(): Promise<CompanyOptionsPayload | null> {
  const row = await prisma.companyOptionsSnapshot.findUnique({ where: { id: SNAPSHOT_ID } });
  return row ? (row.payload as unknown as CompanyOptionsPayload) : null;
}
