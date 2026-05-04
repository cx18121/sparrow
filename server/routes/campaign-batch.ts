import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { HttpError } from "../lib/user.js";
import { Batch } from "../lib/batch.js";
import { parseBody } from "../lib/parse-params.js";

// Thin HTTP adapter for the Batch module. All Batch lifecycle logic lives in
// server/lib/batch.ts — this route only does request parsing + status mapping.

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

async function getBatch(req: VercelRequest, res: VercelResponse, userId: string) {
  const { campaignId } = req.query as Record<string, string | undefined>;
  if (!campaignId) throw new HttpError(400, "campaignId is required");
  const batch = await Batch.current(campaignId, userId);
  return res.status(200).json(batch);
}

async function generateBatch(req: VercelRequest, res: VercelResponse, userId: string) {
  const body = parseBody(req);
  const { campaignId } = body ?? {};
  if (!campaignId) throw new HttpError(400, "campaignId is required");
  const batch = await Batch.generate(campaignId as string, userId, process.env.APOLLO_API_KEY ?? null);
  return res.status(200).json(batch);
}

async function resetBatch(req: VercelRequest, res: VercelResponse, userId: string) {
  const { campaignId } = req.query as Record<string, string | undefined>;
  if (!campaignId) throw new HttpError(400, "campaignId is required");
  await Batch.resetHistory(campaignId, userId);
  res.status(200).json({ reset: true });
}
