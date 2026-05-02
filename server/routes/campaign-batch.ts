import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { HttpError } from "../lib/user.js";
import { generateCampaignBatch } from "../lib/campaign-batch.js";
import { parseBody } from "../lib/parse-params.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (req.method === "GET") return getBatch(req, res, userId);
    if (req.method === "POST") return generateBatch(req, res, userId);
    if (req.method === "DELETE") return resetBatch(req, res, userId);

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Returns the leads for the current batch. Same call always returns the same companies.
async function getBatch(req: VercelRequest, res: VercelResponse, userId: string) {
  const { campaignId } = req.query as Record<string, string | undefined>;
  if (!campaignId) throw new HttpError(400, "campaignId is required");

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.userId !== userId) throw new HttpError(404, "Campaign not found");

  if (campaign.currentBatch === 0) {
    return res.status(200).json({ leads: [], total: 0, currentBatch: 0, seenTotal: 0 });
  }

  const campaignLeads = await prisma.campaignLead.findMany({
    where: { campaignId, batchNumber: campaign.currentBatch },
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

  return res.status(200).json({
    leads: campaignLeads.map(cl => ({ ...cl.userLead, campaignLeadId: cl.id })),
    total: campaignLeads.length,
    currentBatch: campaign.currentBatch,
    seenTotal,
  });
}

// Generates the next Batch — delegates fully to lib/campaign-batch.ts.
async function generateBatch(req: VercelRequest, res: VercelResponse, userId: string) {
  const body = parseBody(req);
  const { campaignId } = body ?? {};
  if (!campaignId) throw new HttpError(400, 'campaignId is required');

  const result = await generateCampaignBatch(
    campaignId as string,
    userId,
    process.env.APOLLO_API_KEY ?? null
  );
  return res.status(200).json(result);
}

// Clears all batch history for a campaign so it starts fresh.
async function resetBatch(req: VercelRequest, res: VercelResponse, userId: string) {
  const { campaignId } = req.query as Record<string, string | undefined>;
  if (!campaignId) throw new HttpError(400, "campaignId is required");

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.userId !== userId) throw new HttpError(404, "Campaign not found");

  await prisma.campaignLead.deleteMany({ where: { campaignId } });
  await prisma.campaignSeenCompany.deleteMany({ where: { campaignId } });
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentBatch: 0 } });

  res.status(200).json({ reset: true });
}
