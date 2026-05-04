import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { HttpError } from "../lib/user.js";
import { parseBody } from "../lib/parse-params.js";
import { sendRouteError } from "../lib/route-error.js";
import {
  addCampaignMember,
  listCampaignMembers,
  removeCampaignCustomContact,
  removeCampaignMember,
} from "../lib/campaign-membership.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (req.method === "GET") return await list(req, res, userId);
    if (req.method === "POST") return await add(req, res, userId);
    if (req.method === "DELETE") return await remove(req, res, userId);

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return sendRouteError(res, err);
  }
}

async function list(req: VercelRequest, res: VercelResponse, userId: string) {
  const { campaignId } = req.query as Record<string, string | undefined>;
  const result = await listCampaignMembers(campaignId, userId);
  return res.status(200).json(result);
}

async function add(req: VercelRequest, res: VercelResponse, userId: string) {
  const result = await addCampaignMember(parseBody(req), userId);
  return res.status(result.created ? 201 : 200).json(result.item);
}

async function remove(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id, kind } = req.query as Record<string, string | undefined>;
  if (kind === "custom-contact") {
    await removeCampaignCustomContact(id, userId);
  } else {
    await removeCampaignMember(id, userId);
  }
  return res.status(204).end();
}
