import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserIdFromRequest } from "../../lib/supabaseAdmin.js";
import { HttpError } from "../../lib/user.js";
import { sendDraft } from "../../lib/send-draft.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { emailId } = body ?? {};
    if (!emailId) return res.status(400).json({ error: "emailId is required" });
    const email = await sendDraft(emailId as string, userId);
    return res.status(200).json({ success: true, email });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: "Internal server error" });
  }
}
