import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { prisma } from "../../lib/prisma.js";
import { getSupabaseAdmin, getUserIdFromRequest } from "../../lib/supabaseAdmin.js";
import { decrypt } from "../../lib/crypto.js";
import { parseWorkspaceConfig } from "../../lib/workspace-config.js";

function encodeHeader(value: string): string {
  return value.replace(/[\r\n"]/g, "");
}

function encodeAddressHeader(name: string | null, email: string): string {
  const cleanEmail = email.replace(/[\r\n<>]/g, "").trim();
  const cleanName = name?.replace(/[\r\n"]/g, "").trim();
  return cleanName ? `${cleanName} <${cleanEmail}>` : cleanEmail;
}

function chunkBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? value;
}

function buildMimeMessage(
  toHeader: string,
  encodedSubject: string,
  htmlBody: string,
  attachments: Array<{ fileName: string; contentType: string; contentBase64: string }>
): string {
  if (attachments.length === 0) {
    return [
      `To: ${toHeader}`,
      `Subject: ${encodedSubject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
      "",
      htmlBody,
    ].join("\r\n");
  }
  const mixedBoundary = `mixed_${Date.now()}`;
  const altBoundary = `alt_${Date.now()}`;
  const lines = [
    `To: ${toHeader}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    htmlBody,
    "",
    `--${altBoundary}--`,
  ];
  for (const att of attachments) {
    lines.push(
      `--${mixedBoundary}`,
      `Content-Type: ${att.contentType}; name="${encodeHeader(att.fileName)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${encodeHeader(att.fileName)}"`,
      "",
      att.contentBase64,
    );
  }
  lines.push(`--${mixedBoundary}--`);
  return lines.join("\r\n");
}

function mimeFromFileName(fileName: string | null | undefined): string {
  const lower = (fileName ?? "").toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

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
  if (email.status === "sent") return res.status(409).json({ error: "Email has already been sent." });
  if (email.status !== "draft" && email.status !== "failed") {
    return res.status(409).json({ error: "Email is already being sent. Refresh Drafts and try again." });
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

  const subject = email.subject ?? "(no subject)";
  const htmlBody = email.body ?? "";
  const toName = email.contact?.name ?? email.customContact?.name ?? null;
  const toHeader = encodeAddressHeader(toName, toEmail);
  const workspaceConfig = parseWorkspaceConfig(profile.workspace_config);
  const rawDailyMax = Number(workspaceConfig.sendingLimits?.dailyMax ?? 100);
  const dailyMax = Number.isFinite(rawDailyMax) ? Math.min(500, Math.max(1, Math.round(rawDailyMax))) : 100;

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const sentToday = await prisma.email.count({
    where: {
      status: "sent",
      sentAt: { gte: startOfToday },
      OR: [{ userLead: { userId } }, { customContact: { userId } }],
    },
  });
  if (sentToday >= dailyMax) {
    return res.status(429).json({
      error: `Daily send limit reached (${sentToday}/${dailyMax}). Try again tomorrow.`,
    });
  }

  const claimed = await prisma.email.updateMany({
    where: { id: emailId as string, status: { in: ["draft", "failed"] } },
    data: { status: "sending" },
  });
  if (claimed.count !== 1) {
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
      await prisma.email.update({ where: { id: emailId as string }, data: { status: "failed" } });
      return res.status(400).json({ error: `Attachment "${fileId}" not found in your file library. Remove it from this draft and try again.` });
    }
    if (!meta.path.startsWith(ownedPrefix)) {
      await prisma.email.update({ where: { id: emailId as string }, data: { status: "failed" } });
      return res.status(403).json({ error: "One or more attachment paths are invalid. Re-upload your files in Settings." });
    }
    const { data: file, error } = await supabase.storage.from("resumes").download(meta.path);
    if (error || !file) {
      await prisma.email.update({ where: { id: emailId as string }, data: { status: "failed" } });
      return res.status(400).json({ error: `Could not read "${meta.fileName}". Re-upload it in Settings and try again.` });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    attachments.push({
      fileName: meta.fileName,
      contentType: meta.mimeType || mimeFromFileName(meta.fileName),
      contentBase64: chunkBase64(buffer.toString("base64")),
    });
  }

  const message = buildMimeMessage(toHeader, encodeHeader(subject), htmlBody, attachments);

  const raw = Buffer.from(message).toString("base64url");

  try {
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  } catch (err: any) {
    const gmailMsg = err?.response?.data?.error?.message ?? err?.message ?? "Gmail send failed";
    await prisma.email.update({ where: { id: emailId as string }, data: { status: "failed" } });
    return res.status(502).json({ error: gmailMsg });
  }

  const updated = await prisma.email.update({
    where: { id: emailId as string },
    data: { status: "sent", sentAt: new Date() },
  });

  return res.status(200).json({ success: true, email: updated });
}
