import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { audienceToPrismaWhere } from "../lib/audience-query.js";
import { parseBody } from "../lib/parse-params.js";
import { shuffle } from "../lib/company-selection.js";
import type { Audience } from "../../src/types/audience.js";

// Live audience preview for the campaign wizard's Step 2.
// Body: { audience, excludePreviouslySaved? }
//  - audience: the same shape exported from src/types/audience.ts
//  - excludePreviouslySaved (default true): when true, drop companies the user
//    has already saved as UserLeads. Mirrors the dedup that batch generation
//    will enforce. The wizard's "Include leads I've already saved in past
//    campaigns" toggle inverts this flag.
//
// Returns { count, sample } where sample is up to 6 randomly-picked company
// names so the user has a tangible preview ("~84 companies match. Sample: …")
// instead of always seeing the alphabetical head ("14.ai, 1stCollab, 222…").

const SAMPLE_SIZE = 6;

// Pick up to SAMPLE_SIZE company names at random from the matched pool.
// For small pools (<= SAMPLE_SIZE) we fetch everything and shuffle. For
// larger pools we pick distinct random offsets and fetch each in parallel
// — much cheaper than loading the whole pool into memory just to discard
// most of it. The orderBy is required for deterministic offsets; the
// shuffle randomises which rows we land on.
async function pickRandomSample(
  where: Record<string, unknown>,
  count: number,
): Promise<string[]> {
  if (count === 0) return [];
  if (count <= SAMPLE_SIZE) {
    const rows = await prisma.company.findMany({ where, select: { name: true } });
    return shuffle(rows.map(r => r.name)).slice(0, count);
  }
  const offsets = new Set<number>();
  while (offsets.size < SAMPLE_SIZE) offsets.add(Math.floor(Math.random() * count));
  const batches = await Promise.all(
    Array.from(offsets).map(offset =>
      prisma.company.findMany({
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

function isAudienceLike(value: unknown): value is Partial<Audience> {
  return Boolean(value) && typeof value === "object";
}

function normaliseAudience(input: Partial<Audience>): Audience {
  return {
    tags: Array.isArray(input.tags) ? input.tags.filter((t): t is string => typeof t === "string") : [],
    region: typeof input.region === "string" ? input.region : null,
    stage: typeof input.stage === "string" ? input.stage : null,
    batch: typeof input.batch === "string" ? input.batch : null,
    isHiring: typeof input.isHiring === "boolean" ? input.isHiring : null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = parseBody(req) ?? {};
  const audienceInput = (body as { audience?: unknown }).audience;
  if (!isAudienceLike(audienceInput)) {
    return res.status(400).json({ error: "audience is required" });
  }

  const audience = normaliseAudience(audienceInput);
  const excludePreviouslySaved =
    (body as { excludePreviouslySaved?: unknown }).excludePreviouslySaved !== false;

  const baseWhere = audienceToPrismaWhere(audience);

  let where: Record<string, unknown> = baseWhere;
  if (excludePreviouslySaved) {
    const savedCompanyIds = await prisma.userLead.findMany({
      where: { userId },
      select: { companyId: true },
      distinct: ["companyId"],
    });
    const ids = savedCompanyIds.map(r => r.companyId).filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      where = { ...baseWhere, id: { notIn: ids } };
    }
  }

  const count = await prisma.company.count({ where });
  const sample = await pickRandomSample(where, count);

  return res.status(200).json({ count, sample });
}
