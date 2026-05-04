import { prisma, type Db } from "./prisma.js";
import { audienceFromCampaign, audienceToPrismaWhere, buildTagFilters, type CampaignFilters } from "./audience-query.js";

export type { CampaignFilters };
export { buildTagFilters };

// Fisher-Yates shuffle. Shared by campaign batch selection and discovery.
export function shuffle<T>(items: T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Builds the Prisma where clause for a Campaign's audience filters.
// Thin wrapper around the shared CampaignAudience module.
export function buildCampaignWhere(campaign: CampaignFilters) {
  return audienceToPrismaWhere(audienceFromCampaign(campaign));
}

// Selects company IDs for the next Batch, excluding already-seen companies.
// Falls back to all matching companies if the unseen pool is exhausted.
export async function selectCandidateIds(
  campaignId: string,
  campaign: CampaignFilters,
  seenIds: string[],
  batchSize: number,
  db: Db = prisma
): Promise<{ selectedIds: string[]; usingFallback: boolean }> {
  const existingLeads = await db.campaignLead.findMany({
    where: { campaignId },
    select: { userLead: { select: { companyId: true } } },
  });
  const alreadyInCampaignIds = existingLeads
    .map(row => row.userLead.companyId)
    .filter((id): id is string => Boolean(id));
  const excludedIds = Array.from(new Set([...seenIds, ...alreadyInCampaignIds]));

  const baseWhere = buildCampaignWhere(campaign);

  let candidates = await db.company.findMany({
    where: { ...baseWhere, ...(excludedIds.length > 0 && { id: { notIn: excludedIds } }) },
    select: { id: true },
  });

  const usingFallback = candidates.length === 0;
  if (usingFallback) {
    candidates = await db.company.findMany({ where: baseWhere, select: { id: true } });
  }

  return {
    selectedIds: shuffle(candidates).slice(0, batchSize).map(c => c.id),
    usingFallback,
  };
}
