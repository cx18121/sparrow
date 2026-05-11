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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  // All option queries restricted to verified companies.
  const verifiedFilter = { isVerified: true };

  try {
    const usRegions = [...US_REGIONS];
    const [industries, regions, stages, batches, sources, tagRows, hiringCount, usCount, intlCount, remoteCount] = await Promise.all([
      prisma.company.findMany({
        where: { ...verifiedFilter, industry: { not: null } },
        distinct: ["industry"],
        select: { industry: true },
        orderBy: { industry: "asc" },
      }),
      prisma.company.findMany({
        where: { ...verifiedFilter, region: { not: null } },
        distinct: ["region"],
        select: { region: true },
        orderBy: { region: "asc" },
      }),
      prisma.company.findMany({
        where: { ...verifiedFilter, stage: { not: null } },
        distinct: ["stage"],
        select: { stage: true },
        orderBy: { stage: "asc" },
      }),
      prisma.company.findMany({
        where: { ...verifiedFilter, batch: { not: null } },
        distinct: ["batch"],
        select: { batch: true },
        orderBy: { batch: "desc" },
      }),
      prisma.company.findMany({
        where: verifiedFilter,
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

    // Frontend gets two things:
    //   - tags: realized distribution (what's actually in DB) per namespace
    //   - canonicalTags: the full vocabulary so unseen tags can render as greyed chips
    res.status(200).json({
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
    });
  } catch (err) {
    res.status(500).json({ error: "Could not load campaign options" });
  }
}
