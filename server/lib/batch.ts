// Batch — first-class module owning the full Batch lifecycle.
//
// In domain terms (CONTEXT.md): "A single group of leads generated from a
// Campaign at one point in time." Owns:
//   - generation (selection + Apollo enrichment + persistence)
//   - reading current/specific batches
//   - seen-history tracking and reset
//   - Campaign.currentBatch counter advancement
//
// Callers depend on the Batch interface, not on CampaignLead / CampaignSeenCompany
// directly. The Prisma layout is an implementation detail.

import { prisma } from "./prisma.js";
import { enrichContactFromDomain } from "./apollo-enrichment.js";
import { selectCandidateIds } from "./company-selection.js";
import { consumeDurableDailyQuota, QuotaError } from "./rate-limit.js";
import { HttpError } from "./user.js";

export interface BatchValue {
  leads: unknown[];
  total: number;
  currentBatch: number;
  seenTotal: number;
  usingFallback: boolean;
}

export interface BatchHistory {
  currentBatch: number;
  seenTotal: number;
}

async function requireOwnedCampaign(campaignId: string, userId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.userId !== userId) throw new HttpError(404, "Campaign not found");
  return campaign;
}

// Same shape used by GET /api/campaign-batch — the most-recent batch's leads.
async function readCurrent(campaignId: string, currentBatch: number): Promise<BatchValue> {
  if (currentBatch === 0) {
    return { leads: [], total: 0, currentBatch: 0, seenTotal: 0, usingFallback: false };
  }

  const campaignLeads = await prisma.campaignLead.findMany({
    where: { campaignId, batchNumber: currentBatch },
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

  return {
    leads: campaignLeads.map(cl => ({ ...cl.userLead, campaignLeadId: cl.id, batchNumber: cl.batchNumber })),
    total: campaignLeads.length,
    currentBatch,
    seenTotal,
    usingFallback: false,
  };
}

export const Batch = {
  // Generates the next Batch. Selects unseen companies via the Audience filters,
  // enriches each via Apollo if no Contact exists, creates UserLeads, and records
  // CampaignLeads under a new batch number. Advances Campaign.currentBatch.
  async generate(
    campaignId: string,
    userId: string,
    apolloKey: string | null
  ): Promise<BatchValue> {
    const campaign = await requireOwnedCampaign(campaignId, userId);

    const newBatchNumber = campaign.currentBatch + 1;
    const batchSize = Math.min(campaign.batchSize ?? 10, 50);

    const seen = await prisma.campaignSeenCompany.findMany({
      where: { campaignId },
      select: { companyId: true },
    });
    const seenIds = seen.map(s => s.companyId);

    const { selectedIds, usingFallback } = await selectCandidateIds(
      campaignId, campaign, seenIds, batchSize
    );

    if (selectedIds.length === 0) {
      return {
        leads: [], total: 0,
        currentBatch: campaign.currentBatch,
        seenTotal: seenIds.length,
        usingFallback: false,
      };
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

    // Track which companies actually got a CampaignLead. We mark seen *after*
    // the loop so a mid-loop failure (Apollo quota, Prisma error) doesn't
    // permanently exclude companies for which no lead was created.
    const successfullySeenIds: string[] = [];

    const createdLeads = [];
    for (const company of companies) {
      let contact: { id: string; name: string | null; email: string | null; title: string | null } | null =
        company.contacts[0] ?? null;
      let apolloPersonId: string | null = null;

      if (!contact && apolloKey && company.domain) {
        try {
          await consumeDurableDailyQuota("apollo", userId, "reveal", Number(process.env.APOLLO_REVEAL_DAILY_LIMIT ?? 50));
        } catch (err) {
          if (err instanceof QuotaError) throw new HttpError(429, "Daily Apollo reveal limit reached. Try again tomorrow.");
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
            userId, companyId: company.id, contactId,
            apolloPersonId: apolloPersonId ?? undefined,
            status: "SAVED",
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

      successfullySeenIds.push(company.id);

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

    if (!usingFallback && successfullySeenIds.length > 0) {
      await prisma.campaignSeenCompany.createMany({
        data: successfullySeenIds.map(companyId => ({ campaignId, companyId })),
        skipDuplicates: true,
      });
    }

    await prisma.campaign.update({ where: { id: campaignId }, data: { currentBatch: newBatchNumber } });

    return {
      leads: createdLeads,
      total: createdLeads.length,
      currentBatch: newBatchNumber,
      seenTotal: usingFallback ? seenIds.length : seenIds.length + successfullySeenIds.length,
      usingFallback,
    };
  },

  // Reads the most recently generated batch.
  async current(campaignId: string, userId: string): Promise<BatchValue> {
    const campaign = await requireOwnedCampaign(campaignId, userId);
    return readCurrent(campaignId, campaign.currentBatch);
  },

  // Counts of seen companies + current batch number, without loading the leads.
  async history(campaignId: string, userId: string): Promise<BatchHistory> {
    const campaign = await requireOwnedCampaign(campaignId, userId);
    const seenTotal = await prisma.campaignSeenCompany.count({ where: { campaignId } });
    return { currentBatch: campaign.currentBatch, seenTotal };
  },

  // Erases all batch state for a Campaign so it starts fresh. Does not delete
  // UserLeads — those are user-owned and survive a reset.
  async resetHistory(campaignId: string, userId: string): Promise<void> {
    await requireOwnedCampaign(campaignId, userId);
    await prisma.campaignLead.deleteMany({ where: { campaignId } });
    await prisma.campaignSeenCompany.deleteMany({ where: { campaignId } });
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentBatch: 0 } });
  },
};
