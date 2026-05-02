import { prisma } from "./prisma.js";
import { US_REGIONS } from "../../scripts/_lib/region-map.js";

export interface CampaignFilters {
  filterTags: string[];
  filterRegion: string | null;
  filterStage: string | null;
  filterBatch: string | null;
  filterIsHiring: boolean | null;
  filterHeadcountMin: number | null;
  filterHeadcountMax: number | null;
}

// Group a flat tag list by namespace prefix for AND-across-namespaces / OR-within logic.
export function buildTagFilters(tags: string[]) {
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
export async function selectCandidateIds(
  campaignId: string,
  campaign: CampaignFilters,
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
  const andConditions = [...tagFilters];
  let regionWhere: Record<string, unknown> = {};
  if (campaign.filterRegion === "__US__") {
    regionWhere = { region: { in: [...US_REGIONS] } };
  } else if (campaign.filterRegion === "__INTL__") {
    andConditions.push({ region: { not: null } } as any);
    andConditions.push({ region: { notIn: [...US_REGIONS, "Remote"] } } as any);
  } else if (campaign.filterRegion === "__REMOTE__") {
    regionWhere = { region: "Remote" };
  } else if (campaign.filterRegion) {
    regionWhere = { region: campaign.filterRegion };
  }

  const baseWhere = {
    isVerified: true,
    ...(andConditions.length > 0 && { AND: andConditions }),
    ...regionWhere,
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
