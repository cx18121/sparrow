import { prisma, type Db } from "./prisma.js";
import { audienceFromCampaign, audienceToPrismaWhere, type CampaignFilters } from "./audience-query.js";
import type { Audience } from "../../src/types/audience.js";

const SAMPLE_SIZE = 6;

export function shuffle<T>(items: T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function pickRandomSample(where: Record<string, unknown>, count: number, db: Db): Promise<string[]> {
  if (count === 0) return [];
  if (count <= SAMPLE_SIZE) {
    const rows = await db.company.findMany({ where, select: { name: true } });
    return shuffle(rows.map(r => r.name)).slice(0, count);
  }
  const offsets = new Set<number>();
  while (offsets.size < SAMPLE_SIZE) offsets.add(Math.floor(Math.random() * count));
  const batches = await Promise.all(
    Array.from(offsets).map(offset =>
      db.company.findMany({
        where,
        select: { name: true },
        orderBy: { id: "asc" },
        skip: offset,
        take: 1,
      }),
    ),
  );
  return batches.flatMap(b => b.map(c => c.name));
}

export async function previewAudiencePool(
  userId: string,
  params: { audience: Audience; excludePreviouslySaved?: boolean; db?: Db },
) {
  const db = params.db ?? prisma;
  const baseWhere = audienceToPrismaWhere(params.audience);
  let where: Record<string, unknown> = baseWhere;

  if (params.excludePreviouslySaved !== false) {
    const savedCompanyIds = await db.userLead.findMany({
      where: { userId },
      select: { companyId: true },
      distinct: ["companyId"],
    });
    const ids = savedCompanyIds.map(r => r.companyId).filter((id): id is string => Boolean(id));
    if (ids.length > 0) where = { ...baseWhere, id: { notIn: ids } };
  }

  const count = await db.company.count({ where });
  const sample = await pickRandomSample(where, count, db);
  return { count, sample };
}

export async function selectAudienceCandidateIds(params: {
  campaignId: string;
  campaign: CampaignFilters;
  seenIds: string[];
  batchSize: number;
  db?: Db;
}): Promise<{ selectedIds: string[]; usingFallback: boolean }> {
  const db = params.db ?? prisma;
  const existingLeads = await db.campaignLead.findMany({
    where: { campaignId: params.campaignId },
    select: { userLead: { select: { companyId: true } } },
  });
  const alreadyInCampaignIds = existingLeads
    .map(row => row.userLead.companyId)
    .filter((id): id is string => Boolean(id));
  const excludedIds = Array.from(new Set([...params.seenIds, ...alreadyInCampaignIds]));

  const baseWhere = audienceToPrismaWhere(audienceFromCampaign(params.campaign));

  let candidates = await db.company.findMany({
    where: { ...baseWhere, ...(excludedIds.length > 0 && { id: { notIn: excludedIds } }) },
    select: { id: true },
  });

  const usingFallback = candidates.length === 0;
  if (usingFallback) {
    candidates = await db.company.findMany({ where: baseWhere, select: { id: true } });
  }

  return {
    selectedIds: shuffle(candidates).slice(0, params.batchSize).map(c => c.id),
    usingFallback,
  };
}
