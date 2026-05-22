import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { CANONICAL_TAG_GROUPS, TAG_NAMESPACES } from "../../scripts/_lib/tags.js";
import { mergeStages } from "../../scripts/_lib/stages.js";
import { US_REGIONS } from "../../scripts/_lib/region-map.js";

interface TagFacet {
  name: string;            // e.g. "fintech"
  count: number;           // companies with this tag
  namespaced: string;      // full "vertical:fintech" form for filter param
}

interface OptionsPayload {
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

// Module-scoped cache. The response is global (all verified companies,
// no user-specific data), so a single shared entry per warm Vercel
// instance is correct. The 10 parallel Company-wide reads behind this
// endpoint dominate cold-start latency — the partial indexes from
// 20260522230500 brought the 5 DISTINCT queries from 1.2s avg to ~30ms,
// but the live `unnest(tags) GROUP BY tag` aggregate (~40s tail under
// load) is uncovered and the only durable fix at endpoint level.
//
// 60s TTL means the worst case is one user paying the aggregate cost
// per minute per warm instance; everyone else hits in-memory. Options
// change only on ingest completion (rare), so 60s staleness is fine.
//
// inFlight is a single-flight gate: if 10 concurrent requests arrive
// on cold cache, only one runs the queries — the rest await the same
// promise. This was the exact thundering-herd that helped saturate
// the Supavisor pool during the 2026-05-22 incident.
const CACHE_TTL_MS = 60_000;
let cache: { data: OptionsPayload; expiresAt: number } | null = null;
let inFlight: Promise<OptionsPayload> | null = null;

async function computeOptions(): Promise<OptionsPayload> {
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

async function getOptions(): Promise<OptionsPayload> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.data;

  // Coalesce concurrent cold-cache callers onto one query.
  if (!inFlight) {
    inFlight = computeOptions()
      .then(data => {
        cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
        return data;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = await getOptions();
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: "Could not load campaign options" });
  }
}
