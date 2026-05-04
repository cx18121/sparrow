import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { HttpError } from "../lib/user.js";
import { parseBody } from "../lib/parse-params.js";
import {
  createCampaignDefinition,
  deleteCampaignDefinition,
  listCampaignDefinitions,
  updateCampaignDefinition,
} from "../lib/campaign-definition.js";


export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    if (req.method === "GET") return await list(req, res, userId);
    if (req.method === "POST") return await create(req, res, userId);
    if (req.method === "PATCH") return await update(req, res, userId);
    if (req.method === "DELETE") return await remove(req, res, userId);

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function list(req: VercelRequest, res: VercelResponse, userId: string) {
  const { status } = req.query as Record<string, string | undefined>;
  const items = await listCampaignDefinitions(userId, status);
  res.status(200).json({ items });
}

async function create(req: VercelRequest, res: VercelResponse, userId: string) {
  const campaign = await createCampaignDefinition(userId, parseBody(req));
  res.status(201).json(campaign);
}

async function update(req: VercelRequest, res: VercelResponse, userId: string) {
  const campaign = await updateCampaignDefinition(userId, parseBody(req));
  res.status(200).json(campaign);
}

async function remove(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id } = req.query as Record<string, string | undefined>;
  await deleteCampaignDefinition(userId, id);
  res.status(204).end();
}
