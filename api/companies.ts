import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "./_lib/prisma.js";
import { getUserIdFromRequest } from "./_lib/supabaseAdmin.js";
import { groupTagsByNamespace } from "../scripts/_lib/tags.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const {
    region,
    batch,
    industry,
    industries,
    isHiring,
    search,
    sort,
    limit = "50",
    cursor,
    withContact,
    tags,
    sources,
    minScore,
  } = req.query as Record<string, string | undefined>;

  const industryFilter = industries
    ? { industry: { in: industries.split(",") } }
    : industry
    ? { industry }
    : {};

  const tagsList = tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : [];
  // Group tags by namespace prefix → AND across categories, OR within.
  // ?tags=vertical:fintech,vertical:health,tech:ai means (fintech OR health) AND ai.
  const tagsByNs = groupTagsByNamespace(tagsList);
  const tagFilters = Object.values(tagsByNs).map(group => ({
    tags: { hasSome: group },
  }));
  const sourcesList = sources ? sources.split(",").map(s => s.trim()).filter(Boolean) : [];
  const minScoreNum = minScore ? parseInt(minScore, 10) : null;

  const take = Math.min(parseInt(limit ?? "50", 10) || 50, 200);

  try {
    const companies = await prisma.company.findMany({
      where: {
        // Hide unverified companies (e.g. unresolved PH placeholders) — no opt-out
        // exposed to clients. Add an admin/service-auth gate if debug access is needed.
        isVerified: true,
        ...(region && { region }),
        ...(batch && { batch }),
        ...industryFilter,
        ...(isHiring && { isHiring: isHiring === "true" }),
        ...(tagFilters.length > 0 && { AND: tagFilters }),
        ...(sourcesList.length > 0 && { source: { in: sourcesList } }),
        ...(minScoreNum != null && { qualityScore: { gte: minScoreNum } }),
        ...(search && {
          name: { startsWith: search, mode: "insensitive" },
        }),
      },
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: sort === "name"
        ? [{ name: "asc" }, { id: "asc" }]
        : sort === "score"
        ? [{ qualityScore: "desc" }, { id: "asc" }]
        : [{ contacts: { _count: "desc" } }, { createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        domain: true,
        oneLiner: true,
        website: true,
        industry: true,
        region: true,
        stage: true,
        batch: true,
        isHiring: true,
        source: true,
        tags: true,
        qualityScore: true,
        _count: { select: { contacts: true } },
        ...(withContact === "1" && {
          contacts: {
            take: 1,
            where: { email: { not: null } },
            orderBy: { lastVerifiedAt: "desc" },
            select: { id: true, name: true, email: true, title: true, role: true },
          },
        }),
      },
    });

    const hasMore = companies.length > take;
    const items = hasMore ? companies.slice(0, take) : companies;
    const nextCursor = hasMore ? items[items.length - 1]?.id : null;

    res.status(200).json({ items, nextCursor });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
