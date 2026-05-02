import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { HttpError } from "../lib/user.js";

const ALLOWED_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"] as const;
type CampaignStatus = (typeof ALLOWED_STATUSES)[number];

async function validateTemplateAccess(templateId: unknown, userId: string) {
  if (!templateId) return null;
  if (typeof templateId !== "string") return null;
  const template = await prisma.template.findUnique({
    where: { id: templateId },
    select: { id: true, userId: true, isShared: true },
  });
  if (!template || (template.userId !== userId && !template.isShared)) {
    throw new HttpError(404, "Template not found");
  }
  return template.id;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, "Invalid numeric value");
  return parsed;
}

function parseBatchSize(value: unknown): number {
  const parsed = value == null || value === "" ? 10 : Number(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, "Invalid batch size");
  return Math.min(Math.max(parsed, 1), 100);
}

function parseNullableBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new HttpError(400, "Invalid boolean value");
}

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
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
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
    filterTags, filterRegion, filterStage, filterBatch, filterIsHiring,
    filterHeadcountMin, filterHeadcountMax, batchSize, tone,
  } = body ?? {};
  if (!name) return res.status(400).json({ error: "name is required" });

  if (status && !ALLOWED_STATUSES.includes(status as CampaignStatus)) {
    return res.status(400).json({
      error: `status must be one of ${ALLOWED_STATUSES.join(", ")}`,
    });
  }
  let ownedTemplateId: string | null;
  try {
    ownedTemplateId = await validateTemplateAccess(templateId, userId);
  } catch {
    return res.status(404).json({ error: "Template not found" });
  }

  const campaign = await prisma.campaign.create({
    data: {
      userId,
      name: name as string,
      subject: (subject as string | null) ?? null,
      status: ((status as CampaignStatus) ?? "DRAFT"),
      templateId: ownedTemplateId,
      scheduledAt: scheduledAt ? new Date(scheduledAt as string) : null,
      filterTags: Array.isArray(filterTags) ? (filterTags as string[]) : [],
      filterRegion: (filterRegion as string | null) ?? null,
      filterStage: (filterStage as string | null) ?? null,
      filterBatch: (filterBatch as string | null) ?? null,
      filterIsHiring: parseNullableBoolean(filterIsHiring),
      filterHeadcountMin: parseNullableNumber(filterHeadcountMin),
      filterHeadcountMax: parseNullableNumber(filterHeadcountMax),
      batchSize: parseBatchSize(batchSize),
      tone: (tone as string | null) ?? null,
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
    filterTags, filterRegion, filterStage, filterBatch, filterIsHiring,
    filterHeadcountMin, filterHeadcountMax, batchSize, tone,
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
  let ownedTemplateId: string | null | undefined = undefined;
  if (templateId !== undefined) {
    try {
      ownedTemplateId = await validateTemplateAccess(templateId, userId);
    } catch {
      return res.status(404).json({ error: "Template not found" });
    }
  }

  const campaign = await prisma.campaign.update({
    where: { id: id as string },
    data: {
      ...(name !== undefined && { name: name as string }),
      ...(subject !== undefined && { subject: subject as string | null }),
      ...(status !== undefined && { status: status as CampaignStatus }),
      ...(templateId !== undefined && { templateId: ownedTemplateId }),
      ...(scheduledAt !== undefined && {
        scheduledAt: scheduledAt ? new Date(scheduledAt as string) : null,
      }),
      ...(filterTags !== undefined && { filterTags: Array.isArray(filterTags) ? (filterTags as string[]) : [] }),
      ...(filterRegion !== undefined && { filterRegion: (filterRegion as string | null) ?? null }),
      ...(filterStage !== undefined && { filterStage: (filterStage as string | null) ?? null }),
      ...(filterBatch !== undefined && { filterBatch: (filterBatch as string | null) ?? null }),
      ...(filterIsHiring !== undefined && { filterIsHiring: parseNullableBoolean(filterIsHiring) }),
      ...(filterHeadcountMin !== undefined && { filterHeadcountMin: parseNullableNumber(filterHeadcountMin) }),
      ...(filterHeadcountMax !== undefined && { filterHeadcountMax: parseNullableNumber(filterHeadcountMax) }),
      ...(batchSize !== undefined && { batchSize: parseBatchSize(batchSize) }),
      ...(tone !== undefined && { tone: (tone as string | null) ?? null }),
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
