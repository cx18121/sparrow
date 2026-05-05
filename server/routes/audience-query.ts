import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { parseBody } from "../lib/parse-params.js";
import { sendRouteError } from "../lib/route-error.js";
import { previewAudiencePool } from "../lib/audience-pool.js";
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

  try {
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

    const { count, sample } = await previewAudiencePool(userId, { audience, excludePreviouslySaved });

    return res.status(200).json({ count, sample });
  } catch (err) {
    return sendRouteError(res, err);
  }
}
