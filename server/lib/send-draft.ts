import { google } from "googleapis";
import { prisma } from "./prisma.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { decrypt } from "./crypto.js";
import { attachmentLibraryFromWorkspaceConfig, normalizeSendingLimits, parseWorkspaceConfig } from "./workspace-config.js";
import {
  encodeHeader,
  encodeAddressHeader,
  sanitizeHtml,
  buildMimeMessage,
  buildAttachment,
  mimeFromFileName,
} from "./email-mime.js";
import { SENDABLE_STATUSES, claimForSending, markSent, markFailed } from "./email-status.js";
import { checkEmailSendQuota, QuotaError } from "./rate-limit.js";
import { HttpError } from "./user.js";
import { invalidateEmailDashboardCache } from "./email-cache.js";

async function readOwnedDraft(emailId: string, userId: string) {
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: {
      contact: { select: { email: true, name: true } },
      customContact: { select: { email: true, name: true, userId: true } },
      userLead: { select: { userId: true } },
    },
  });

  if (!email) throw new HttpError(404, "Email not found");
  const ownerUserId = email.userLead?.userId ?? email.customContact?.userId;
  if (ownerUserId !== userId) throw new HttpError(404, "Email not found");

  if (!(SENDABLE_STATUSES as readonly string[]).includes(email.status)) {
    throw new HttpError(
      409,
      email.status === "sent"
        ? "Email has already been sent."
        : "Email is already being sent. Refresh Drafts and try again."
    );
  }

  const toEmail = email.contact?.email ?? email.customContact?.email ?? null;
  if (!toEmail) throw new HttpError(400, "No recipient email address on this draft.");

  return { email, toEmail };
}

async function readOwnedDraftForTest(emailId: string, userId: string) {
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: {
      customContact: { select: { userId: true } },
      userLead: { select: { userId: true } },
    },
  });

  if (!email) throw new HttpError(404, "Email not found");
  const ownerUserId = email.userLead?.userId ?? email.customContact?.userId;
  if (ownerUserId !== userId) throw new HttpError(404, "Email not found");

  return email;
}

async function readSenderProfile(userId: string) {
  const supabase = getSupabaseAdmin();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("google_refresh_token_encrypted, resume_path, workspace_config")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile?.google_refresh_token_encrypted) {
    throw new HttpError(400, "Connect Gmail in Settings before sending email.");
  }

  let refreshToken: string;
  try {
    refreshToken = decrypt(profile.google_refresh_token_encrypted);
  } catch {
    throw new HttpError(500, "We could not read your saved Google connection. Reconnect Google in Settings.");
  }

  return {
    supabase,
    refreshToken,
    workspaceConfig: {
      ...parseWorkspaceConfig(profile.workspace_config),
      resumePath: parseWorkspaceConfig(profile.workspace_config).resumePath || profile.resume_path || null,
    },
  };
}

async function markRecipientEmailed(email: { userLeadId?: string | null; customContactId?: string | null }) {
  try {
    if (email.userLeadId) {
      await prisma.userLead.update({ where: { id: email.userLeadId }, data: { status: "EMAILED" } });
      return;
    }
    if (email.customContactId) {
      await prisma.customContact.update({ where: { id: email.customContactId }, data: { status: "EMAILED" } });
    }
  } catch (err) {
    console.warn("Could not mark recipient EMAILED after Gmail send:", err);
  }
}

async function buildDraftAttachments(params: {
  userId: string;
  emailId: string;
  attachmentIds: unknown;
  fileLibrary: Array<{ id: string; path: string; fileName: string; mimeType?: string | null }>;
  supabase: ReturnType<typeof getSupabaseAdmin>;
}) {
  const { userId, emailId, attachmentIds, fileLibrary, supabase } = params;
  const emailAttachmentIds = Array.isArray(attachmentIds) ? (attachmentIds as string[]) : [];
  const ownedPrefixes = [`files/${userId}/`, `${userId}/`];
  const attachments: Array<{ fileName: string; contentType: string; contentBase64: string }> = [];

  for (const fileId of emailAttachmentIds) {
    const meta = fileLibrary.find(f => f.id === fileId);
    if (!meta) {
      await markFailed(emailId);
      throw new HttpError(400, `Attachment "${fileId}" not found in your file library. Remove it from this draft and try again.`);
    }
    if (!ownedPrefixes.some(prefix => meta.path.startsWith(prefix))) {
      await markFailed(emailId);
      throw new HttpError(403, "One or more attachment paths are invalid. Re-upload your files in Settings.");
    }
    const { data: file, error } = await supabase.storage.from("resumes").download(meta.path);
    if (error || !file) {
      await markFailed(emailId);
      throw new HttpError(400, `Could not read "${meta.fileName}". Re-upload it in Settings and try again.`);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    attachments.push(buildAttachment(meta.fileName, meta.mimeType || mimeFromFileName(meta.fileName), buffer));
  }

  return attachments;
}

export async function sendDraft(emailId: string, userId: string) {
  const { email, toEmail } = await readOwnedDraft(emailId, userId);
  const { supabase, refreshToken, workspaceConfig } = await readSenderProfile(userId);

  const { dailyMax } = normalizeSendingLimits(workspaceConfig.sendingLimits);

  try {
    await checkEmailSendQuota(userId, dailyMax);
  } catch (err) {
    if (err instanceof QuotaError) throw new HttpError(429, err.message);
    throw err;
  }

  const claimed = await claimForSending(emailId);
  if (!claimed) {
    throw new HttpError(409, "Email is already being sent or was sent. Refresh Drafts and try again.");
  }

  const attachments = await buildDraftAttachments({
    userId,
    emailId,
    attachmentIds: email.attachmentIds,
    fileLibrary: attachmentLibraryFromWorkspaceConfig(workspaceConfig),
    supabase,
  });

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  const subject = email.subject ?? "(no subject)";
  const htmlBody = sanitizeHtml(email.body ?? "");
  const toName = email.contact?.name ?? email.customContact?.name ?? null;
  const toHeader = encodeAddressHeader(toName, toEmail);
  const message = buildMimeMessage(toHeader, encodeHeader(subject), htmlBody, attachments);
  const raw = Buffer.from(message).toString("base64url");

  try {
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  } catch {
    await markFailed(emailId);
    throw new HttpError(502, "Gmail send failed");
  }

  const updated = await markSent(emailId);
  await markRecipientEmailed(email);
  invalidateEmailDashboardCache(userId);
  return updated;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendTestDraft(emailId: string, userId: string, recipient: string) {
  const trimmed = recipient.trim();
  if (!EMAIL_RE.test(trimmed)) {
    throw new HttpError(400, "Provide a valid recipient email address.");
  }

  const email = await readOwnedDraftForTest(emailId, userId);
  const { supabase, refreshToken, workspaceConfig } = await readSenderProfile(userId);

  const { dailyMax } = normalizeSendingLimits(workspaceConfig.sendingLimits);

  // Test sends still consume daily quota — Gmail is sending real mail through
  // the user's account, so the cap protects against an OAuth-revoke storm just
  // as much as it would for real sends.
  try {
    await checkEmailSendQuota(userId, dailyMax);
  } catch (err) {
    if (err instanceof QuotaError) throw new HttpError(429, err.message);
    throw err;
  }

  const attachments = await buildDraftAttachments({
    userId,
    emailId,
    attachmentIds: email.attachmentIds,
    fileLibrary: attachmentLibraryFromWorkspaceConfig(workspaceConfig),
    supabase,
  });

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  const subject = `[TEST] ${email.subject ?? "(no subject)"}`;
  const htmlBody = sanitizeHtml(email.body ?? "");
  const toHeader = encodeAddressHeader(null, trimmed.toLowerCase());
  const message = buildMimeMessage(toHeader, encodeHeader(subject), htmlBody, attachments);
  const raw = Buffer.from(message).toString("base64url");

  try {
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  } catch {
    throw new HttpError(502, "Gmail send failed");
  }

  return { recipient: trimmed.toLowerCase() };
}
