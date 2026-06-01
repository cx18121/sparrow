import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "../../lib/prisma.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { decrypt } from "../../lib/crypto.js";
import { classifyReply, headersFromGmailPayload } from "../../lib/reply-classification.js";

const oidcClient = new OAuth2Client();

async function verifyOidcToken(authHeader: string | undefined): Promise<boolean> {
  const audience = process.env.GMAIL_WEBHOOK_AUDIENCE;
  if (!audience) return false;
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  try {
    const ticket = await oidcClient.verifyIdToken({ idToken: token, audience });
    // verifyIdToken already proves the token is Google-signed and aud-matched.
    // When GMAIL_WEBHOOK_SA_EMAIL is configured, also pin the caller to the
    // exact Pub/Sub push service account — without this, anyone who can mint a
    // Google ID token for our audience (from any Google project) would pass.
    // Gated on the env var so the check is opt-in and existing deploys keep
    // working until the service-account email is set.
    const expectedEmail = process.env.GMAIL_WEBHOOK_SA_EMAIL?.trim();
    if (expectedEmail) {
      const payload = ticket?.getPayload?.();
      if (payload?.email !== expectedEmail || payload?.email_verified !== true) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

// Gmail historyIds are monotonically increasing per mailbox. Only advance the
// stored cursor when the incoming notification is strictly newer — a replayed
// or out-of-order Pub/Sub delivery carrying a stale historyId must not drag
// the cursor backward (which would re-walk already-processed history).
function historyIdIsNewer(incoming: string, current: string): boolean {
  try {
    return BigInt(incoming) > BigInt(current);
  } catch {
    return false; // non-numeric id → never advance
  }
}

function parsePubSubMessage(body: unknown): { emailAddress: string; historyId: string } | null {
  try {
    const msg = (body as any)?.message;
    if (!msg?.data) return null;
    const decoded = JSON.parse(Buffer.from(msg.data, "base64").toString("utf8"));
    if (!decoded?.emailAddress || !decoded?.historyId) return null;
    return { emailAddress: decoded.emailAddress, historyId: String(decoded.historyId) };
  } catch {
    return null;
  }
}

// Collects all messageIds from all pages of history.list.
async function fetchAllNewMessageIds(
  gmail: ReturnType<typeof google.gmail>,
  startHistoryId: string,
): Promise<{ messageIds: Set<string>; ok: boolean }> {
  const messageIds = new Set<string>();
  let pageToken: string | undefined;

  try {
    do {
      const res = await gmail.users.history.list({
        userId: "me",
        startHistoryId,
        historyTypes: ["messageAdded"],
        labelId: "INBOX",
        ...(pageToken && { pageToken }),
      });
      for (const entry of res.data.history ?? []) {
        for (const added of entry.messagesAdded ?? []) {
          if (added.message?.id) messageIds.add(added.message.id);
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return { messageIds, ok: true };
  } catch {
    return { messageIds, ok: false };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const valid = await verifyOidcToken(req.headers.authorization as string | undefined);
  if (!valid) return res.status(401).json({ error: "Unauthorized" });

  const parsed = parsePubSubMessage(req.body);
  if (!parsed) return res.status(200).end(); // ACK unrecognized messages

  const { emailAddress, historyId: incomingHistoryId } = parsed;

  const watch = await prisma.userGmailWatch.findUnique({ where: { email: emailAddress } });
  if (!watch) return res.status(200).end();

  const supabase = getSupabaseAdmin();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("google_refresh_token_encrypted")
    .eq("user_id", watch.userId)
    .maybeSingle();

  if (!profile?.google_refresh_token_encrypted) return res.status(200).end();

  let refreshToken: string;
  try {
    refreshToken = decrypt(profile.google_refresh_token_encrypted);
  } catch {
    return res.status(200).end();
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  // Paginate through all history pages before processing. If fetching fails
  // we return without advancing the cursor so Pub/Sub retries.
  const { messageIds: newMessageIds, ok: historyOk } = await fetchAllNewMessageIds(
    gmail,
    watch.historyId,
  );
  if (!historyOk) return res.status(200).end();

  // Track whether any message failed so we can decide whether to advance the cursor.
  let anyFailed = false;

  for (const messageId of newMessageIds) {
    try {
      const msgRes = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Auto-Submitted", "X-Autoreply", "X-Auto-Response-Suppress"],
      });
      const msg = msgRes.data;
      if (!msg.threadId) continue;

      const sentEmail = await prisma.email.findFirst({
        where: { gmailThreadId: msg.threadId },
        select: {
          id: true,
          userLeadId: true,
          customContactId: true,
          replyMessageId: true,
          userLead: { select: { userId: true } },
          customContact: { select: { userId: true } },
        },
      });
      if (!sentEmail) continue;

      const ownerUserId = sentEmail.userLead?.userId ?? sentEmail.customContact?.userId;
      if (ownerUserId !== watch.userId) continue;

      // Idempotency: skip if already recorded this exact reply message
      if (sentEmail.replyMessageId === messageId) continue;

      const headers = headersFromGmailPayload(msg.payload ?? {});
      const fromAddress = headers["from"] ?? "";

      // Skip messages the user sent themselves
      if (fromAddress.includes(emailAddress)) continue;

      const subject = headers["subject"] ?? "";
      const snippet = msg.snippet ?? "";
      const classification = classifyReply({ fromAddress, subject, snippet, headers });

      await prisma.email.update({
        where: { id: sentEmail.id },
        data: {
          repliedAt: new Date(),
          replyMessageId: messageId,
          replyFrom: fromAddress,
          replyClassification: classification,
        },
      });

      // Translate the inbound classification into a lead-status transition.
      // A real REPLY advances the lead to RESPONDED; a BOUNCE marks it
      // BOUNCED so the undeliverable address isn't treated as a live
      // awaiting-reply lead or re-emailed. AUTO_REPLY/OTHER leave status
      // untouched (the lead stays EMAILED — still legitimately in flight).
      const nextLeadStatus =
        classification === "REPLY"
          ? "RESPONDED"
          : classification === "BOUNCE"
            ? "BOUNCED"
            : null;
      if (nextLeadStatus) {
        // Update lead status for both UserLead and CustomContact paths.
        if (sentEmail.userLeadId) {
          await prisma.userLead.update({
            where: { id: sentEmail.userLeadId },
            data: { status: nextLeadStatus },
          });
        } else if (sentEmail.customContactId) {
          await prisma.customContact.update({
            where: { id: sentEmail.customContactId },
            data: { status: nextLeadStatus },
          });
        }
      }
    } catch (err) {
      console.error("Failed to process Gmail message", messageId, err);
      anyFailed = true;
    }
  }

  // Only advance the cursor when all messages processed cleanly AND the
  // incoming historyId is newer than what we've stored. If any message
  // failed, withhold the update so Pub/Sub retries from the old historyId;
  // if the id isn't newer, the delivery was a replay/out-of-order dupe.
  if (!anyFailed && historyIdIsNewer(incomingHistoryId, watch.historyId)) {
    await prisma.userGmailWatch.update({
      where: { userId: watch.userId },
      data: { historyId: incomingHistoryId },
    });
  }

  return res.status(200).end();
}
