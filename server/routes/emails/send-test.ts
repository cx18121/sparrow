import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserIdFromRequest } from "../../lib/supabaseAdmin.js";
import { parseBody } from "../../lib/parse-params.js";
import { sendTestDraft } from "../../lib/send-draft.js";
import { sendRouteError } from "../../lib/route-error.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const body = parseBody(req);
    const { emailId, recipient } = body ?? {};
    if (!emailId || typeof emailId !== "string") {
      return res.status(400).json({ error: "emailId is required" });
    }
    if (!recipient || typeof recipient !== "string") {
      return res.status(400).json({ error: "recipient is required" });
    }

    const result = await sendTestDraft(emailId, userId, recipient);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return sendRouteError(res, err);
  }
}
