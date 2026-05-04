import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { prisma } from "../../lib/prisma.js";
import { getSupabaseAdmin, getUserIdFromRequest } from "../../lib/supabaseAdmin.js";
import { decrypt } from "../../lib/crypto.js";
import { parseWorkspaceConfig } from "../../lib/workspace-config.js";
import {
  encodeHeader, encodeAddressHeader, sanitizeHtml, buildMimeMessage, buildAttachment, mimeFromFileName,
} from "../../lib/email-mime.js";
import { SENDABLE_STATUSES, claimForSending, markSent, markFailed } from "../../lib/email-status.js";
import { checkEmailSendQuota, QuotaError } from "../../lib/rate-limit.js";

declare global { var __dashCache: Map<string, { data: unknown; ts: number }> | undefined }
function invalidateDashCache(userId: string) { globalThis.__dashCache?.delete(userId) }

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

  if (!(SENDABLE_STATUSES as readonly string[]).includes(email.status)) {
    return res.status(409).json({
      error: email.status === "sent"
        ? "Email has already been sent."
        : "Email is already being sent. Refresh Drafts and try again.",
    });
  }

  const toEmail = email.contact?.email ?? email.customContact?.email ?? null;
  if (!toEmail) return res.status(400).json({ error: "No recipient email address on this draft." });

  const supabase = getSupabaseAdmin();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("google_refresh_token_encrypted, resume_path, workspace_config")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile?.google_refresh_token_encrypted) {
    return res.status(400).json({
      error: "Connect Gmail in Settings before sending email.",
    });
  }

  let refreshToken: string;
  try {
    refreshToken = decrypt(profile.google_refresh_token_encrypted);
  } catch {
    return res.status(500).json({ error: "We could not read your saved Google connection. Reconnect Google in Settings." });
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: refreshToken });

  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  const workspaceConfig = parseWorkspaceConfig(profile.workspace_config);
  const rawDailyMax = Number(workspaceConfig.sendingLimits?.dailyMax ?? 100);
  const dailyMax = Number.isFinite(rawDailyMax) ? Math.min(500, Math.max(1, Math.round(rawDailyMax))) : 100;

  try {
    await checkEmailSendQuota(userId, dailyMax);
  } catch (err) {
    if (err instanceof QuotaError) return res.status(429).json({ error: err.message });
    throw err;
  }

  const claimed = await claimForSending(emailId as string);
  if (!claimed) {
    return res.status(409).json({ error: "Email is already being sent or was sent. Refresh Drafts and try again." });
  }

  // Build attachment list from email.attachmentIds + file library in workspace_config
  const fileLibrary = workspaceConfig.files ?? [];
  const emailAttachmentIds = Array.isArray(email.attachmentIds) ? (email.attachmentIds as string[]) : [];
  const ownedPrefix = `files/${userId}/`;

  const attachments: Array<{ fileName: string; contentType: string; contentBase64: string }> = [];
  for (const fileId of emailAttachmentIds) {
    const meta = fileLibrary.find(f => f.id === fileId);
    if (!meta) {
      await markFailed(emailId as string);
      return res.status(400).json({ error: `Attachment "${fileId}" not found in your file library. Remove it from this draft and try again.` });
    }
    if (!meta.path.startsWith(ownedPrefix)) {
      await markFailed(emailId as string);
      return res.status(403).json({ error: "One or more attachment paths are invalid. Re-upload your files in Settings." });
    }
    const { data: file, error } = await supabase.storage.from("resumes").download(meta.path);
    if (error || !file) {
      await markFailed(emailId as string);
      return res.status(400).json({ error: `Could not read "${meta.fileName}". Re-upload it in Settings and try again.` });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    attachments.push(buildAttachment(meta.fileName, meta.mimeType || mimeFromFileName(meta.fileName), buffer));
  }

  const subject = email.subject ?? "(no subject)";
  const htmlBody = sanitizeHtml(email.body ?? "");
  const toName = email.contact?.name ?? email.customContact?.name ?? null;
  const toHeader = encodeAddressHeader(toName, toEmail);
  const message = buildMimeMessage(toHeader, encodeHeader(subject), htmlBody, attachments);
  const raw = Buffer.from(message).toString("base64url");

  try {
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  } catch (err: any) {
    await markFailed(emailId as string);
    return res.status(502).json({ error: "Gmail send failed" });
  }

  const updated = await markSent(emailId as string);
  invalidateDashCache(userId);
  return res.status(200).json({ success: true, email: updated });
}
