import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { HttpError } from "../lib/user.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (req.method === "GET") return list(req, res, userId);
    if (req.method === "POST") return add(req, res, userId);
    if (req.method === "DELETE") return remove(req, res, userId);

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: (err as Error).message });
  }
}

async function requireCampaign(campaignId: string, userId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.userId !== userId) throw new HttpError(404, "Campaign not found");
  return campaign;
}

function includeLead() {
  return {
    userLead: {
      include: {
        company: {
          select: {
            id: true, name: true, domain: true, oneLiner: true,
            industry: true, region: true, stage: true, batch: true, isHiring: true,
          },
        },
        contact: { select: { id: true, name: true, email: true, title: true } },
        emails: { orderBy: { createdAt: "desc" as const }, take: 1, select: { id: true, subject: true, status: true } },
      },
    },
  };
}

async function list(req: VercelRequest, res: VercelResponse, userId: string) {
  const { campaignId } = req.query as Record<string, string | undefined>;
  if (!campaignId) throw new HttpError(400, "campaignId is required");
  await requireCampaign(campaignId, userId);

  const rows = await prisma.campaignLead.findMany({
    where: { campaignId },
    orderBy: [{ batchNumber: "asc" }, { createdAt: "desc" }],
    include: includeLead(),
  });

  return res.status(200).json({
    items: rows.map(row => ({ ...row.userLead, campaignLeadId: row.id, batchNumber: row.batchNumber })),
  });
}

async function add(req: VercelRequest, res: VercelResponse, userId: string) {
  const body = parseBody(req);
  const { campaignId, userLeadId } = body ?? {};
  if (!campaignId) throw new HttpError(400, "campaignId is required");
  if (!userLeadId) throw new HttpError(400, "userLeadId is required");

  await requireCampaign(campaignId as string, userId);
  const lead = await prisma.userLead.findUnique({ where: { id: userLeadId as string } });
  if (!lead || lead.userId !== userId) throw new HttpError(404, "Lead not found");

  const existing = await prisma.campaignLead.findFirst({
    where: { campaignId: campaignId as string, userLeadId: userLeadId as string },
    include: includeLead(),
  });
  if (existing) {
    return res.status(200).json({ ...existing.userLead, campaignLeadId: existing.id, batchNumber: existing.batchNumber });
  }

  const row = await prisma.campaignLead.create({
    data: { campaignId: campaignId as string, userLeadId: userLeadId as string, batchNumber: 0 },
    include: includeLead(),
  });

  return res.status(201).json({ ...row.userLead, campaignLeadId: row.id, batchNumber: row.batchNumber });
}

async function remove(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id } = req.query as Record<string, string | undefined>;
  if (!id) throw new HttpError(400, "id query param is required");

  const row = await prisma.campaignLead.findUnique({
    where: { id },
    include: { campaign: { select: { userId: true } } },
  });
  if (!row || row.campaign.userId !== userId) throw new HttpError(404, "Campaign company not found");

  await prisma.campaignLead.delete({ where: { id } });
  return res.status(204).end();
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
