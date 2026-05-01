import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { getUserIdFromRequest } from "../_lib/supabaseAdmin.js";
import {
  GOOGLE_GMAIL_SCOPES,
  encodeGoogleConnectState,
  getRequestBaseUrl,
  sanitizeReturnTo,
} from "../_lib/google-connect.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const returnTo = sanitizeReturnTo(body?.returnTo);
  const baseUrl = getRequestBaseUrl(req);
  const redirectUri = `${baseUrl}/api/google/callback`;
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri,
  );

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: GOOGLE_GMAIL_SCOPES,
    state: encodeGoogleConnectState({ userId, returnTo, redirectUri, iat: Date.now() }),
  });

  return res.status(200).json({ url });
}
