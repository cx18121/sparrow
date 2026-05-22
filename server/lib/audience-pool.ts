import { Prisma } from "@prisma/client";
import { prisma, type Db } from "./prisma.js";
import { audienceFromCampaign, audienceToPrismaWhere, audienceToSqlPredicates, type CampaignFilters } from "./audience-query.js";
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
  // Same anti-join pattern as server/routes/companies.ts random discovery,
  // but the exclusion set is different here: we exclude (a) the caller's
  // precomputed seenIds (typically CampaignSeenCompany rows) and (b) any
  // company already attached to this campaign via CampaignLead → UserLead.
  // Old shape did all this with `notIn: [...thousands of IDs]` + JS shuffle
  // — fine at 12k Company but bad as the table grew past 30k.
  const db = params.db ?? prisma;
  const audience = audienceFromCampaign(params.campaign);
  const predicates = audienceToSqlPredicates(audience);
  const whereClause = Prisma.join(predicates, " AND ");

  const selected = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT c.id
    FROM "Company" c
    WHERE ${whereClause}
      AND c.id != ALL(${params.seenIds}::text[])
      AND NOT EXISTS (
        SELECT 1 FROM "CampaignLead" cl
        JOIN "UserLead" ul ON ul.id = cl."userLeadId"
        WHERE cl."campaignId" = ${params.campaignId}
          AND ul."companyId" = c.id
      )
    ORDER BY random()
    LIMIT ${params.batchSize}
  `);

  let selectedIds = selected.map(r => r.id);
  let usingFallback = false;
  if (selectedIds.length === 0) {
    const fallback = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT c.id
      FROM "Company" c
      WHERE ${whereClause}
      ORDER BY random()
      LIMIT ${params.batchSize}
    `);
    selectedIds = fallback.map(r => r.id);
    usingFallback = true;
  }

  return { selectedIds, usingFallback };
}
