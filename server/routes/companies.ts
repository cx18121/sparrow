import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { audienceToPrismaWhere } from "../lib/audience-query.js";
import { REGION_US, REGION_INTL, REGION_REMOTE } from "../../src/types/audience.js";
import { shuffle } from "../lib/company-selection.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") return list(req, res, userId);
  if (req.method === "DELETE") return resetDiscoverySeen(req, res, userId);

  res.setHeader("Allow", "GET, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}

// Companies endpoint takes a single regionType / region from the query
// string (the discover/browse UI is single-select), so this returns a 0- or
// 1-element array to feed the multi-select audience adapter.
function regionFromQuery(regionType: string | undefined, region: string | undefined): string[] {
  if (regionType === "us") return [REGION_US];
  if (regionType === "international") return [REGION_INTL];
  if (regionType === "remote") return [REGION_REMOTE];
  return region ? [region] : [];
}

async function list(req: VercelRequest, res: VercelResponse, userId: string) {
  const {
    region,
    regionType,
    batch,
    stage,
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

  const tagsList = tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : [];
  const sourcesList = sources ? sources.split(",").map(s => s.trim()).filter(Boolean) : [];
  const minScoreNum = minScore ? parseInt(minScore, 10) : null;

  const industryFilter = industries
    ? { industry: { in: industries.split(",") } }
    : industry
    ? { industry }
    : {};

  // Build the core audience-driven filter through the canonical adapter so
  // Discover and Campaign batch selection always produce identical WHERE clauses.
  const audienceWhere = audienceToPrismaWhere({
    tags: tagsList,
    region: regionFromQuery(regionType, region),
    stage: stage ? [stage] : [],
    batch: batch ? [batch] : [],
    isHiring: isHiring === "true" ? true : isHiring === "false" ? false : null,
    // Discover endpoint scopes by company attributes only; target role is a
    // contact-side concern resolved later via Apollo. Pass null to skip.
    targetRole: null,
  });

  const take = Math.min(parseInt(limit ?? "50", 10) || 50, 200);
  const baseWhere = {
    ...audienceWhere,
    ...industryFilter,
    ...(sourcesList.length > 0 && { source: { in: sourcesList } }),
    ...(minScoreNum != null && { qualityScore: { gte: minScoreNum } }),
    ...(search && { name: { startsWith: search, mode: "insensitive" as const } }),
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
