import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../../lib/prisma.js";
import { getUserIdFromRequest } from "../../lib/supabaseAdmin.js";
import { classifyReply } from "../../lib/reply-classification.js";
import { invalidateEmailDashboardCache } from "../../lib/email-cache.js";

// Dev-only: simulate a Gmail reply landing on a sent Email row without
// needing the real Pub/Sub → OIDC → gmail.history.list → messages.get
// pipeline. Runs the same inner classify+update loop as the production
// webhook (server/routes/webhooks/gmail.ts:118-186) so reply tracking
// can be exercised end-to-end against the actual DB and UI from a curl.
//
// Hard-gated by NODE_ENV — returns 404 in production so the route looks
// non-existent. Caller must own the target Email row (verified via the
// same auth path every other route uses); we deliberately don't let one
// user inject a reply onto another user's draft, even in dev.
//
// Unlike the webhook, this route DOES invalidate the dashboard cache
// after writing so the UI reflects the change on the next /api/emails
// fetch. The webhook intentionally doesn't (cache TTL absorbs it across
// real reply traffic), but for dev iteration immediate feedback matters
// more.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // In production, the route doesn't exist.
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = (req.body ?? {}) as {
    emailId?: unknown;
    fromAddress?: unknown;
    subject?: unknown;
    snippet?: unknown;
    headers?: unknown;
  };

  if (typeof body.emailId !== "string" || body.emailId.length === 0) {
    return res.status(400).json({ error: "emailId is required" });
  }

  const fromAddress = typeof body.fromAddress === "string" ? body.fromAddress : "replier@example.com";
  const subject = typeof body.subject === "string" ? body.subject : "Re: outreach";
  const snippet = typeof body.snippet === "string" ? body.snippet : "Thanks for reaching out — happy to chat.";
  const extraHeaders = body.headers && typeof body.headers === "object" && !Array.isArray(body.headers)
    ? Object.fromEntries(
        Object.entries(body.headers as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .map(([k, v]) => [k.toLowerCase(), v]),
      )
    : {};

  const headers: Record<string, string> = {
    from: fromAddress,
    subject,
    ...extraHeaders,
  };

  const email = await prisma.email.findUnique({
    where: { id: body.emailId },
    select: {
      id: true,
      userLeadId: true,
      customContactId: true,
      userLead: { select: { userId: true } },
      customContact: { select: { userId: true } },
    },
  });
  if (!email) return res.status(404).json({ error: "Email not found" });

  const ownerUserId = email.userLead?.userId ?? email.customContact?.userId ?? null;
  if (ownerUserId !== userId) return res.status(404).json({ error: "Email not found" });

  const classification = classifyReply({ fromAddress, subject, snippet, headers });

  // Fresh synthetic message id every call so re-injection doesn't trip the
  // webhook's idempotency check (we mirror its replyMessageId semantics).
  const replyMessageId = `dev-injected-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const updated = await prisma.email.update({
    where: { id: email.id },
    data: {
      repliedAt: new Date(),
      replyMessageId,
      replyFrom: fromAddress,
      replyClassification: classification,
    },
  });

  if (classification === "REPLY") {
    if (email.userLeadId) {
      await prisma.userLead.update({
        where: { id: email.userLeadId },
        data: { status: "RESPONDED" },
      });
    } else if (email.customContactId) {
      await prisma.customContact.update({
        where: { id: email.customContactId },
        data: { status: "RESPONDED" },
      });
    }
  }

  invalidateEmailDashboardCache(userId);

  return res.status(200).json({
    ok: true,
    classification,
    email: updated,
  });
}
