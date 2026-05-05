import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserIdFromRequest } from "../../lib/supabaseAdmin.js";
import { generateDraft, GenerationError, ProfileError } from "../../lib/draft-generation.js";
import { parseBody } from "../../lib/parse-params.js";
import { sendRouteError } from "../../lib/route-error.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const body = parseBody(req) ?? {};
    const { userLeadId, customContactId, templateId, attachmentIds, interestHook, tone, extraContext, includeResumeBullet, save } = body as Record<string, unknown>;

    if (!userLeadId && !customContactId) {
      return res.status(400).json({ error: "userLeadId or customContactId is required" });
    }

    const result = await generateDraft({
      userId,
      userLeadId: userLeadId as string | undefined,
      customContactId: customContactId as string | undefined,
      templateId: templateId as string | null | undefined,
      attachmentIds: Array.isArray(attachmentIds) ? attachmentIds.filter((id): id is string => typeof id === "string") : undefined,
      interestHook: interestHook as string | null | undefined,
      tone: tone as string | null | undefined,
      extraContext: extraContext as string | null | undefined,
      includeResumeBullet: includeResumeBullet as boolean | undefined,
      save: save as boolean | undefined,
    });
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof GenerationError) return res.status(err.status).json({ error: err.message });
    if (err instanceof ProfileError) return res.status(err.status).json({ error: err.message });
    return sendRouteError(res, err, "Could not generate email");
  }
}
