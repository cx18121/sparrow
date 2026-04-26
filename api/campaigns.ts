import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "./_lib/prisma.js";
import { getUserIdFromRequest } from "./_lib/supabaseAdmin.js";

const ALLOWED_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"] as const;
type CampaignStatus = (typeof ALLOWED_STATUSES)[number];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    if (req.method === "GET") return list(req, res, userId);
    if (req.method === "POST") return create(req, res, userId);
    if (req.method === "PATCH") return update(req, res, userId);
    if (req.method === "DELETE") return remove(req, res, userId);

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}

async function list(req: VercelRequest, res: VercelResponse, userId: string) {
  const { status } = req.query as Record<string, string | undefined>;
  const items = await prisma.campaign.findMany({
    where: {
      userId,
      ...(status && ALLOWED_STATUSES.includes(status as CampaignStatus) && {
        status: status as CampaignStatus,
      }),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      template: { select: { id: true, name: true } },
    },
  });
  res.status(200).json({ items });
}

async function create(req: VercelRequest, res: VercelResponse, userId: string) {
  const body = parseBody(req);
  const {
    name, subject, status, templateId, scheduledAt,
    filterIndustry, filterRegion, filterStage, filterBatch, filterIsHiring,
    filterHeadcountMin, filterHeadcountMax, batchSize,
  } = body ?? {};
  if (!name) return res.status(400).json({ error: "name is required" });

  if (status && !ALLOWED_STATUSES.includes(status as CampaignStatus)) {
    return res.status(400).json({
      error: `status must be one of ${ALLOWED_STATUSES.join(", ")}`,
    });
  }

  const campaign = await prisma.campaign.create({
    data: {
      userId,
      name: name as string,
      subject: (subject as string | null) ?? null,
      status: ((status as CampaignStatus) ?? "DRAFT"),
      templateId: (templateId as string | null) ?? null,
      scheduledAt: scheduledAt ? new Date(scheduledAt as string) : null,
      filterIndustry: (filterIndustry as string | null) ?? null,
      filterRegion: (filterRegion as string | null) ?? null,
      filterStage: (filterStage as string | null) ?? null,
      filterBatch: (filterBatch as string | null) ?? null,
      filterIsHiring: filterIsHiring != null ? Boolean(filterIsHiring) : null,
      filterHeadcountMin: filterHeadcountMin != null ? Number(filterHeadcountMin) : null,
      filterHeadcountMax: filterHeadcountMax != null ? Number(filterHeadcountMax) : null,
      batchSize: batchSize != null ? Math.min(Math.max(Number(batchSize), 1), 100) : 10,
    },
    include: {
      template: { select: { id: true, name: true } },
    },
  });
  res.status(201).json(campaign);
}

async function update(req: VercelRequest, res: VercelResponse, userId: string) {
  const body = parseBody(req);
  const {
    id, name, subject, status, templateId, scheduledAt,
    filterIndustry, filterRegion, filterStage, filterBatch, filterIsHiring,
    filterHeadcountMin, filterHeadcountMax, batchSize,
  } = body ?? {};
  if (!id) return res.status(400).json({ error: "id is required" });

  if (status && !ALLOWED_STATUSES.includes(status as CampaignStatus)) {
    return res.status(400).json({
      error: `status must be one of ${ALLOWED_STATUSES.join(", ")}`,
    });
  }

  const existing = await prisma.campaign.findUnique({ where: { id: id as string } });
  if (!existing || existing.userId !== userId) {
    return res.status(404).json({ error: "Campaign not found" });
  }

  const campaign = await prisma.campaign.update({
    where: { id: id as string },
    data: {
      ...(name !== undefined && { name: name as string }),
      ...(subject !== undefined && { subject: subject as string | null }),
      ...(status !== undefined && { status: status as CampaignStatus }),
      ...(templateId !== undefined && { templateId: templateId as string | null }),
      ...(scheduledAt !== undefined && {
        scheduledAt: scheduledAt ? new Date(scheduledAt as string) : null,
      }),
      ...(filterIndustry !== undefined && { filterIndustry: (filterIndustry as string | null) ?? null }),
      ...(filterRegion !== undefined && { filterRegion: (filterRegion as string | null) ?? null }),
      ...(filterStage !== undefined && { filterStage: (filterStage as string | null) ?? null }),
      ...(filterBatch !== undefined && { filterBatch: (filterBatch as string | null) ?? null }),
      ...(filterIsHiring !== undefined && { filterIsHiring: filterIsHiring != null ? Boolean(filterIsHiring) : null }),
      ...(filterHeadcountMin !== undefined && { filterHeadcountMin: filterHeadcountMin != null ? Number(filterHeadcountMin) : null }),
      ...(filterHeadcountMax !== undefined && { filterHeadcountMax: filterHeadcountMax != null ? Number(filterHeadcountMax) : null }),
      ...(batchSize !== undefined && { batchSize: Math.min(Math.max(Number(batchSize), 1), 100) }),
    },
    include: {
      template: { select: { id: true, name: true } },
    },
  });
  res.status(200).json(campaign);
}

async function remove(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id } = req.query as Record<string, string | undefined>;
  if (!id) return res.status(400).json({ error: "id query param is required" });

  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return res.status(404).json({ error: "Campaign not found" });
  }

  await prisma.campaign.delete({ where: { id } });
  res.status(204).end();
}

function parseBody(req: VercelRequest): Record<string, unknown> | null {
  if (!req.body) return null;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return req.body as Record<string, unknown>;
}
