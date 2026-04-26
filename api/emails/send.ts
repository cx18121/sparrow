import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { prisma } from "../_lib/prisma.js";
import { getSupabaseAdmin, getUserIdFromRequest } from "../_lib/supabaseAdmin.js";
import { decrypt } from "../_lib/crypto.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const { emailId } = body ?? {};
  if (!emailId) return res.status(400).json({ error: "emailId is required" });

  const email = await prisma.email.findUnique({
    where: { id: emailId as string },
    include: {
      contact: { select: { email: true, name: true } },
      customContact: { select: { email: true, name: true, userId: true } },
      userLead: { select: { userId: true } },
    },
  });

  if (!email) return res.status(404).json({ error: "Email not found" });

  const ownerUserId = email.userLead?.userId ?? email.customContact?.userId;
  if (ownerUserId !== userId) return res.status(404).json({ error: "Email not found" });

  const toEmail = email.contact?.email ?? email.customContact?.email ?? null;
  if (!toEmail) return res.status(400).json({ error: "No recipient email address on this draft." });

  const supabase = getSupabaseAdmin();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("google_refresh_token_encrypted")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile?.google_refresh_token_encrypted) {
    return res.status(400).json({
      error: "Gmail not connected. Sign in with Google in Settings to enable sending.",
    });
  }

  let refreshToken: string;
  try {
    refreshToken = decrypt(profile.google_refresh_token_encrypted);
  } catch {
    return res.status(500).json({ error: "Unable to decrypt Google credentials." });
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: refreshToken });

  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  const subject = email.subject ?? "(no subject)";
  const htmlBody = email.body ?? "";
  const toName = email.contact?.name ?? email.customContact?.name ?? null;
  const toHeader = toName ? `${toName} <${toEmail}>` : toEmail;

  const message = [
    `To: ${toHeader}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    htmlBody,
  ].join("\r\n");

  const raw = Buffer.from(message).toString("base64url");

  try {
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  } catch (err: any) {
    const gmailMsg = err?.response?.data?.error?.message ?? err?.message ?? "Gmail send failed";
    return res.status(502).json({ error: gmailMsg });
  }

  const updated = await prisma.email.update({
    where: { id: emailId as string },
    data: { status: "sent", sentAt: new Date() },
  });

  return res.status(200).json({ success: true, email: updated });
}
