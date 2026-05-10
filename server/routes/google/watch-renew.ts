import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { renewExpiringWatches } from "../../lib/gmail-watch.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: "CRON_SECRET is not configured" });
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await renewExpiringWatches((refreshToken) => {
      const oauth2 = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      );
      oauth2.setCredentials({ refresh_token: refreshToken });
      return oauth2;
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("Watch renewal failed", err);
    return res.status(500).json({ error: "Watch renewal failed" });
  }
}
