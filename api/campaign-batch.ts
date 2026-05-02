import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "./_lib/prisma.js";
import { getUserIdFromRequest } from "./_lib/supabaseAdmin.js";
import { HttpError } from "./_lib/user.js";
import { enrichDomain } from "./_lib/apollo.js";
import { upsertContactFromReveal } from "./_lib/apollo-enrichment.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (req.method === "GET") return getBatch(req, res, userId);
    if (req.method === "POST") return generateBatch(req, res, userId);
    if (req.method === "DELETE") return resetBatch(req, res, userId);

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: (err as Error).message });
  }
}

// Returns the leads for the current batch. Same call always returns the same companies.
async function getBatch(req: VercelRequest, res: VercelResponse, userId: string) {
  const { campaignId } = req.query as Record<string, string | undefined>;
  if (!campaignId) throw new HttpError(400, "campaignId is required");

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.userId !== userId) throw new HttpError(404, "Campaign not found");

  if (campaign.currentBatch === 0) {
    return res.status(200).json({ leads: [], total: 0, currentBatch: 0, seenTotal: 0 });
  }

  const campaignLeads = await prisma.campaignLead.findMany({
    where: { campaignId, batchNumber: campaign.currentBatch },
    orderBy: { createdAt: "asc" },
    include: {
      userLead: {
        include: {
          company: {
            select: {
              id: true, name: true, domain: true, oneLiner: true,
              industry: true, region: true, stage: true, batch: true, isHiring: true,
            },
          },
          contact: { select: { id: true, name: true, email: true, title: true } },
          emails: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, subject: true, status: true } },
        },
      },
    },
  });

  const seenTotal = await prisma.campaignSeenCompany.count({ where: { campaignId } });

  return res.status(200).json({
    leads: campaignLeads.map(cl => ({ ...cl.userLead, campaignLeadId: cl.id })),
    total: campaignLeads.length,
    currentBatch: campaign.currentBatch,
    seenTotal,
  });
}

// Generates the NEXT batch. Apollo is called to enrich each company with a contact.
// Companies never overlap across batches. If all matching companies are already seen,
// returns seen ones as a fallback instead of returning nothing.
async function generateBatch(req: VercelRequest, res: VercelResponse, userId: string) {
  const body = parseBody(req);
  const { campaignId } = body ?? {};
  if (!campaignId) throw new HttpError(400, "campaignId is required");

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId as string } });
  if (!campaign || campaign.userId !== userId) throw new HttpError(404, "Campaign not found");

  const newBatchNumber = campaign.currentBatch + 1;
  const batchSize = Math.min(campaign.batchSize ?? 10, 100);
  const apolloKey = process.env.APOLLO_API_KEY ?? null;

  const seen = await prisma.campaignSeenCompany.findMany({
    where: { campaignId: campaignId as string },
    select: { companyId: true },
  });
  const seenIds = seen.map(s => s.companyId);

  const { selectedIds, usingFallback } = await selectCandidateIds(
    campaignId as string,
    campaign,
    seenIds,
    batchSize
  );

  if (selectedIds.length === 0) {
    return res.status(200).json({
      leads: [], total: 0, currentBatch: campaign.currentBatch, seenTotal: seenIds.length,
      usingFallback: false,
    });
  }

  const companies = await prisma.company.findMany({
    where: { id: { in: selectedIds } },
    include: {
      contacts: {
        where: { email: { not: null } },
        orderBy: { lastVerifiedAt: "desc" },
        take: 1,
        select: { id: true, name: true, email: true, title: true },
      },
    },
  });

  if (!usingFallback) {
    await prisma.campaignSeenCompany.createMany({
      data: selectedIds.map(companyId => ({ campaignId: campaignId as string, companyId })),
      skipDuplicates: true,
    });
  }

  const createdLeads = [];
  for (const company of companies) {
    let contact: { id: string; name: string | null; email: string | null; title: string | null } | null =
      company.contacts[0] ?? null;
    let apolloPersonId: string | null = null;

    // If no existing contact and Apollo key is configured, enrich via Apollo
    if (!contact && apolloKey && company.domain) {
      const enriched = await enrichDomain(company.domain, apolloKey);
      if (enriched) {
        apolloPersonId = enriched.personId;
        contact = await upsertContactFromReveal(enriched, company.id);
      }
    }

    const contactId = contact?.id ?? null;

    let userLead = await prisma.userLead.findFirst({
      where: { userId, companyId: company.id, contactId },
    });
    if (!userLead) {
      userLead = await prisma.userLead.create({
        data: {
          userId,
          companyId: company.id,
          contactId,
          // Store apolloPersonId so generate-email can auto-reveal if contact email is missing
          apolloPersonId: apolloPersonId ?? undefined,
          status: "NEW",
          notes: `Added via campaign: ${campaign.name}`,
        },
      });
    } else if (apolloPersonId && !userLead.apolloPersonId) {
      await prisma.userLead.update({
        where: { id: userLead.id },
        data: { apolloPersonId },
      });
    }

    await prisma.campaignLead.upsert({
      where: {
        campaignId_batchNumber_userLeadId: {
          campaignId: campaignId as string,
          batchNumber: newBatchNumber,
          userLeadId: userLead.id,
        },
      },
      create: { campaignId: campaignId as string, userLeadId: userLead.id, batchNumber: newBatchNumber },
      update: {},
    });

    createdLeads.push({
      ...userLead,
      emails: [],
      company: {
        id: company.id,
        name: company.name,
        domain: company.domain,
        oneLiner: company.oneLiner,
        industry: company.industry,
        region: company.region,
        stage: company.stage,
        batch: company.batch,
        isHiring: company.isHiring,
      },
      contact,
    });
  }

  await prisma.campaign.update({
    where: { id: campaignId as string },
    data: { currentBatch: newBatchNumber },
  });

  return res.status(200).json({
    leads: createdLeads,
    total: createdLeads.length,
    currentBatch: newBatchNumber,
    seenTotal: usingFallback ? seenIds.length : seenIds.length + selectedIds.length,
    usingFallback,
  });
}

// Clears all batch history for a campaign so it starts fresh.
async function resetBatch(req: VercelRequest, res: VercelResponse, userId: string) {
  const { campaignId } = req.query as Record<string, string | undefined>;
  if (!campaignId) throw new HttpError(400, "campaignId is required");

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.userId !== userId) throw new HttpError(404, "Campaign not found");

  await prisma.campaignLead.deleteMany({ where: { campaignId } });
  await prisma.campaignSeenCompany.deleteMany({ where: { campaignId } });
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentBatch: 0 } });

  res.status(200).json({ reset: true });
}

// Group a flat tag list by namespace prefix for AND-across-namespaces / OR-within logic.
function buildTagFilters(tags: string[]) {
  const byNs: Record<string, string[]> = {};
  for (const t of tags) {
    const idx = t.indexOf(":");
    const ns = idx > 0 ? t.slice(0, idx) : "_";
    (byNs[ns] ??= []).push(t);
  }
  return Object.values(byNs).map(group => ({ tags: { hasSome: group } }));
}

// Selects company IDs for the next batch, excluding already-seen companies.
// Falls back to all matching companies if the unseen pool is exhausted.
async function selectCandidateIds(
  campaignId: string,
  campaign: { filterTags: string[]; filterRegion: string | null; filterStage: string | null; filterBatch: string | null; filterIsHiring: boolean | null; filterHeadcountMin: number | null; filterHeadcountMax: number | null },
  seenIds: string[],
  batchSize: number
): Promise<{ selectedIds: string[]; usingFallback: boolean }> {
  const existingLeads = await prisma.campaignLead.findMany({
    where: { campaignId },
    select: { userLead: { select: { companyId: true } } },
  });
  const alreadyInCampaignIds = existingLeads
    .map(row => row.userLead.companyId)
    .filter((id): id is string => Boolean(id));
  const excludedIds = Array.from(new Set([...seenIds, ...alreadyInCampaignIds]));

  const tagFilters = buildTagFilters(campaign.filterTags ?? []);
  const baseWhere = {
    isVerified: true,
    ...(tagFilters.length > 0 && { AND: tagFilters }),
    ...(campaign.filterRegion && { region: campaign.filterRegion }),
    ...(campaign.filterStage && { stage: campaign.filterStage }),
    ...(campaign.filterBatch && { batch: campaign.filterBatch }),
    ...(campaign.filterIsHiring != null && { isHiring: campaign.filterIsHiring }),
    ...((campaign.filterHeadcountMin != null || campaign.filterHeadcountMax != null) && {
      headcount: {
        ...(campaign.filterHeadcountMin != null && { gte: campaign.filterHeadcountMin }),
        ...(campaign.filterHeadcountMax != null && { lte: campaign.filterHeadcountMax }),
      },
    }),
  };

  let candidates = await prisma.company.findMany({
    where: { ...baseWhere, ...(excludedIds.length > 0 && { id: { notIn: excludedIds } }) },
    select: { id: true },
  });

  const usingFallback = candidates.length === 0;
  if (usingFallback) {
    candidates = await prisma.company.findMany({ where: baseWhere, select: { id: true } });
  }

  // Fisher-Yates shuffle then take batchSize
  const arr = candidates.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return { selectedIds: arr.slice(0, batchSize).map(c => c.id), usingFallback };
}

function parseBody(req: VercelRequest): Record<string, unknown> | null {
  if (!req.body) return null;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return req.body as Record<string, unknown>;
}
