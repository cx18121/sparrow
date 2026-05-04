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

import { prisma, type Db } from "./prisma.js";
import { enrichContactFromDomain } from "./apollo-enrichment.js";
import { selectCandidateIds } from "./company-selection.js";
import { QuotaError } from "./rate-limit.js";
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

async function requireOwnedCampaign(campaignId: string, userId: string, db: Db = prisma) {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
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
  //
  // Bug 10H: serialized per-campaign via a Postgres advisory transaction lock.
  // Concurrent generates against the same campaignId would otherwise:
  //   - both read the same `currentBatch` and produce duplicate batch rows
  //   - race on CampaignSeenCompany inserts and select overlapping companies
  //   - double-spend Apollo reveal quota for the same domain
  // pg_advisory_xact_lock waits for the lock; the second caller queues until
  // the first finishes. The Apollo HTTP calls inside the txn are tolerated
  // because the timeout is generous and per-campaign concurrency in this
  // product is very low (one user, one click).
  async generate(
    campaignId: string,
    userId: string,
    apolloKey: string | null
  ): Promise<BatchValue> {
    return prisma.$transaction(async (tx) => {
      // hashtext returns int4 — the two-arg form pg_advisory_xact_lock(int4, int4)
      // is the safest cross-DB choice. Using a single-arg int8 hash would be
      // fine too, but hashtext is already a stable Postgres function and works
      // without casting.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${campaignId}::text))`;

      const campaign = await requireOwnedCampaign(campaignId, userId, tx);

      const newBatchNumber = campaign.currentBatch + 1;
      const batchSize = Math.min(campaign.batchSize ?? 10, 50);

      const seen = await tx.campaignSeenCompany.findMany({
        where: { campaignId },
        select: { companyId: true },
      });
      const seenIds = seen.map(s => s.companyId);

      const { selectedIds, usingFallback } = await selectCandidateIds(
        campaignId, campaign, seenIds, batchSize, tx
      );

      if (selectedIds.length === 0) {
        return {
          leads: [], total: 0,
          currentBatch: campaign.currentBatch,
          seenTotal: seenIds.length,
          usingFallback: false,
        };
      }

      const companies = await tx.company.findMany({
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
            const enriched = await enrichContactFromDomain(company.domain, company.id, apolloKey, userId, tx);
            contact = enriched.contact;
            apolloPersonId = enriched.apolloPersonId;
          } catch (err) {
            if (err instanceof QuotaError) throw new HttpError(429, "Daily Apollo reveal limit reached. Try again tomorrow.");
            throw err;
          }
        }

        const contactId = contact?.id ?? null;

        let userLead = await tx.userLead.findFirst({ where: { userId, companyId: company.id, contactId } });
        if (!userLead) {
          userLead = await tx.userLead.create({
            data: {
              userId, companyId: company.id, contactId,
              apolloPersonId: apolloPersonId ?? undefined,
              status: "SAVED",
              notes: `Added via campaign: ${campaign.name}`,
            },
          });
        } else if (apolloPersonId && !userLead.apolloPersonId) {
          await tx.userLead.update({ where: { id: userLead.id }, data: { apolloPersonId } });
        }

        await tx.campaignLead.upsert({
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
        await tx.campaignSeenCompany.createMany({
          data: successfullySeenIds.map(companyId => ({ campaignId, companyId })),
          skipDuplicates: true,
        });
      }

      await tx.campaign.update({ where: { id: campaignId }, data: { currentBatch: newBatchNumber } });

      return {
        leads: createdLeads,
        total: createdLeads.length,
        currentBatch: newBatchNumber,
        seenTotal: usingFallback ? seenIds.length : seenIds.length + successfullySeenIds.length,
        usingFallback,
      };
    }, {
      // Apollo enrichment can take several seconds per company; a worst-case
      // batch of 50 with all-empty contact rows is theoretically minutes, so
      // give the txn enough headroom while still capping accidental runaway.
      timeout: 120_000,
      maxWait: 10_000,
    });
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
