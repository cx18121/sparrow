import { prisma, type Db } from "./prisma.js";
import { audienceFromCampaign, audienceToPrismaWhere, buildTagFilters, type CampaignFilters } from "./audience-query.js";
import { selectAudienceCandidateIds, shuffle } from "./audience-pool.js";

export type { CampaignFilters };
export { buildTagFilters, shuffle };

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
  return selectAudienceCandidateIds({ campaignId, campaign, seenIds, batchSize, db });
}
