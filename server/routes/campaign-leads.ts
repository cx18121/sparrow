import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { HttpError } from "../lib/user.js";
import { parseBody } from "../lib/parse-params.js";
import {
  addCampaignMember,
  listCampaignMembers,
  removeCampaignMember,
} from "../lib/campaign-membership.js";

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
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function list(req: VercelRequest, res: VercelResponse, userId: string) {
  const { campaignId } = req.query as Record<string, string | undefined>;
  const items = await listCampaignMembers(campaignId, userId);
  return res.status(200).json({ items });
}

async function add(req: VercelRequest, res: VercelResponse, userId: string) {
  const result = await addCampaignMember(parseBody(req), userId);
  return res.status(result.created ? 201 : 200).json(result.item);
}

async function remove(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id } = req.query as Record<string, string | undefined>;
  await removeCampaignMember(id, userId);
  return res.status(204).end();
}
