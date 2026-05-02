import { prisma } from "./prisma.js";
import { enrichContactFromDomain } from "./apollo-enrichment.js";
import { selectCandidateIds } from "./company-selection.js";
import { consumeDurableDailyQuota, QuotaError } from "./rate-limit.js";
import { HttpError } from "./user.js";

export interface BatchResult {
  leads: unknown[];
  total: number;
  currentBatch: number;
  seenTotal: number;
  usingFallback: boolean;
}

// Generates the next Batch for a Campaign. Selects unseen companies, enriches
// each with a Contact via Apollo if none exists, creates or reuses UserLeads,
// and records CampaignLeads for the new batch number.
export async function generateCampaignBatch(
  campaignId: string,
  userId: string,
  apolloKey: string | null
): Promise<BatchResult> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.userId !== userId) throw new HttpError(404, 'Campaign not found');

  const newBatchNumber = campaign.currentBatch + 1;
  const batchSize = Math.min(campaign.batchSize ?? 10, 50);

  const seen = await prisma.campaignSeenCompany.findMany({
    where: { campaignId },
    select: { companyId: true },
  });
  const seenIds = seen.map(s => s.companyId);

  const { selectedIds, usingFallback } = await selectCandidateIds(
    campaignId,
    campaign,
    seenIds,
    batchSize
  );

  if (selectedIds.length === 0) {
    return { leads: [], total: 0, currentBatch: campaign.currentBatch, seenTotal: seenIds.length, usingFallback: false };
  }

  const companies = await prisma.company.findMany({
    where: { id: { in: selectedIds } },
    include: {
      contacts: {
        where: { email: { not: null } },
        orderBy: { lastVerifiedAt: 'desc' },
        take: 1,
        select: { id: true, name: true, email: true, title: true },
      },
    },
  });

  if (!usingFallback) {
    await prisma.campaignSeenCompany.createMany({
      data: selectedIds.map(companyId => ({ campaignId, companyId })),
      skipDuplicates: true,
    });
  }

  const createdLeads = [];
  for (const company of companies) {
    let contact: { id: string; name: string | null; email: string | null; title: string | null } | null =
      company.contacts[0] ?? null;
    let apolloPersonId: string | null = null;

    if (!contact && apolloKey && company.domain) {
      try {
        await consumeDurableDailyQuota('apollo', userId, 'reveal', Number(process.env.APOLLO_REVEAL_DAILY_LIMIT ?? 50));
      } catch (err) {
        if (err instanceof QuotaError) throw new HttpError(429, 'Daily Apollo reveal limit reached. Try again tomorrow.');
        throw err;
      }
      const enriched = await enrichContactFromDomain(company.domain, company.id, apolloKey);
      contact = enriched.contact;
      apolloPersonId = enriched.apolloPersonId;
    }

    const contactId = contact?.id ?? null;

    let userLead = await prisma.userLead.findFirst({ where: { userId, companyId: company.id, contactId } });
    if (!userLead) {
      userLead = await prisma.userLead.create({
        data: {
          userId,
          companyId: company.id,
          contactId,
          apolloPersonId: apolloPersonId ?? undefined,
          status: 'SAVED',
          notes: `Added via campaign: ${campaign.name}`,
        },
      });
    } else if (apolloPersonId && !userLead.apolloPersonId) {
      await prisma.userLead.update({ where: { id: userLead.id }, data: { apolloPersonId } });
    }

    await prisma.campaignLead.upsert({
      where: { campaignId_batchNumber_userLeadId: { campaignId, batchNumber: newBatchNumber, userLeadId: userLead.id } },
      create: { campaignId, userLeadId: userLead.id, batchNumber: newBatchNumber },
      update: {},
    });

    createdLeads.push({
      ...userLead,
      emails: [],
      company: {
        id: company.id, name: company.name, domain: company.domain, oneLiner: company.oneLiner,
        industry: company.industry, region: company.region, stage: company.stage,
        batch: company.batch, isHiring: company.isHiring,
      },
      contact,
    });
  }

  await prisma.campaign.update({ where: { id: campaignId }, data: { currentBatch: newBatchNumber } });

  return {
    leads: createdLeads,
    total: createdLeads.length,
    currentBatch: newBatchNumber,
    seenTotal: usingFallback ? seenIds.length : seenIds.length + selectedIds.length,
    usingFallback,
  };
}
