import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { groupTagsByNamespace } from "../../scripts/_lib/tags.js";
import { US_REGIONS } from "../../scripts/_lib/region-map.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") return list(req, res, userId);
  if (req.method === "DELETE") return resetDiscoverySeen(req, res, userId);

  res.setHeader("Allow", "GET, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}

async function list(req: VercelRequest, res: VercelResponse, userId: string) {
  const {
    region,
    regionType,
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
    random,
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

  // regionType=us → known US metro regions; regionType=international → everything else
  // (excluding Remote). A plain ?region= exact-match still works when regionType is absent.
  const andConditions = [...tagFilters];
  let regionWhere: Record<string, unknown> = {};
  if (regionType === "us") {
    regionWhere = { region: { in: [...US_REGIONS] } };
  } else if (regionType === "international") {
    andConditions.push({ region: { not: null } } as any);
    andConditions.push({ region: { notIn: [...US_REGIONS, "Remote"] } } as any);
  } else if (regionType === "remote") {
    regionWhere = { region: "Remote" };
  } else if (region) {
    regionWhere = { region };
  }

  const take = Math.min(parseInt(limit ?? "50", 10) || 50, 200);
  const baseWhere = {
    // Hide unverified companies (e.g. unresolved PH placeholders) — no opt-out
    // exposed to clients. Add an admin/service-auth gate if debug access is needed.
    isVerified: true,
    ...regionWhere,
    ...(batch && { batch }),
    ...industryFilter,
    ...(isHiring && { isHiring: isHiring === "true" }),
    ...(andConditions.length > 0 && { AND: andConditions }),
    ...(sourcesList.length > 0 && { source: { in: sourcesList } }),
    ...(minScoreNum != null && { qualityScore: { gte: minScoreNum } }),
    ...(search && {
      name: { startsWith: search, mode: "insensitive" as const },
    }),
  };

  try {
    if (random === "1" || random === "true") {
      const result = await selectRandomDiscoveryCompanies(userId, baseWhere, take, withContact === "1");
      return res.status(200).json(result);
    }

    const companies = await prisma.company.findMany({
      where: baseWhere,
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
    res.status(500).json({ error: "Could not load companies" });
  }
}

async function resetDiscoverySeen(_req: VercelRequest, res: VercelResponse, userId: string) {
  await prisma.discoverySeenCompany.deleteMany({ where: { userId } });
  res.status(200).json({ reset: true });
}

async function selectRandomDiscoveryCompanies(
  userId: string,
  baseWhere: Record<string, unknown>,
  take: number,
  withContact: boolean
) {
  const [seen, saved] = await Promise.all([
    prisma.discoverySeenCompany.findMany({ where: { userId }, select: { companyId: true } }),
    prisma.userLead.findMany({ where: { userId }, select: { companyId: true } }),
  ]);

  const seenIds = seen.map(row => row.companyId);
  const savedIds = saved.map(row => row.companyId).filter((id): id is string => Boolean(id));
  const excludedIds = Array.from(new Set([...seenIds, ...savedIds]));

  let candidates = await prisma.company.findMany({
    where: { ...baseWhere, ...(excludedIds.length > 0 && { id: { notIn: excludedIds } }) },
    select: { id: true },
  });

  const usingFallback = candidates.length === 0;
  if (usingFallback) {
    candidates = await prisma.company.findMany({ where: baseWhere, select: { id: true } });
  }

  const selectedIds = shuffle(candidates).slice(0, take).map(company => company.id);
  const companies = selectedIds.length
    ? await prisma.company.findMany({
        where: { id: { in: selectedIds } },
        select: companySelect(withContact),
      })
    : [];
  const byId = new Map(companies.map(company => [company.id, company]));
  const items = selectedIds.map(id => byId.get(id)).filter(Boolean);

  if (!usingFallback && selectedIds.length > 0) {
    await prisma.discoverySeenCompany.createMany({
      data: selectedIds.map(companyId => ({ userId, companyId })),
      skipDuplicates: true,
    });
  }

  return {
    items,
    nextCursor: null,
    seenTotal: usingFallback ? seenIds.length : seenIds.length + selectedIds.length,
    usingFallback,
    random: true,
  };
}

function companySelect(withContact: boolean) {
  return {
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
    ...(withContact && {
      contacts: {
        take: 1,
        where: { email: { not: null } },
        orderBy: { lastVerifiedAt: "desc" as const },
        select: { id: true, name: true, email: true, title: true, role: true },
      },
    }),
  };
}

function shuffle<T>(items: T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
