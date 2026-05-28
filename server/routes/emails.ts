import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { HttpError } from "../lib/user.js";
import { ALLOWED_EMAIL_STATUSES, isAllowedStatus } from "../lib/email-status.js";
import { invalidateEmailDashboardCache } from "../lib/email-cache.js";
import { countEmailsSentToday, listEmailQueue, readDashboardEmailQueue } from "../lib/email-query.js";

// Generous ceilings — real outreach drafts are ~80–120 words. These exist to
// bound a malicious/buggy client from writing multi-megabyte rows that bloat
// the table and stress every later send/render path, not to constrain normal
// use. Mirrors the MAX_RESUME_LENGTH cap on /api/preview/fit-angle.
const MAX_SUBJECT_LENGTH = 2_000;
const MAX_BODY_LENGTH = 100_000;

// Rejects oversized subject/body. Only checks fields that are present so it
// works for both create (full payload) and update (partial payload).
function assertEmailContentWithinLimits(subject: unknown, body: unknown) {
  if (typeof subject === "string" && subject.length > MAX_SUBJECT_LENGTH) {
    throw new HttpError(400, `subject must be at most ${MAX_SUBJECT_LENGTH} characters`);
  }
  if (typeof body === "string" && body.length > MAX_BODY_LENGTH) {
    throw new HttpError(400, `body must be at most ${MAX_BODY_LENGTH} characters`);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (req.method === "GET") return list(req, res, userId);
    if (req.method === "POST") return create(req, res, userId);
    if (req.method === "PATCH") return update(req, res, userId);
    if (req.method === "DELETE") return remove(req, res, userId);

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}


async function list(req: VercelRequest, res: VercelResponse, userId: string) {
  const { userLeadId, campaignId, status, limit = "50", cursor, countToday, combined } = req.query as Record<
    string,
    string | undefined
  >;

  if (countToday === "true") {
    return res.status(200).json(await countEmailsSentToday(userId))
  }

  if (status && !isAllowedStatus(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${ALLOWED_EMAIL_STATUSES.join(", ")}` });
  }

  const take = Math.min(parseInt(limit ?? "50", 10) || 50, 200);

  // Dashboard combined fetch: drafts + sent in one round trip to avoid two cold starts.
  if (combined === "true") {
    res.setHeader("Cache-Control", "private, max-age=0, stale-while-revalidate=3600")
    return res.status(200).json(await readDashboardEmailQueue(userId, { campaignId }));
  }

  res.status(200).json(await listEmailQueue(userId, { userLeadId, campaignId, status: status as any, limit: take, cursor }));
}

async function create(req: VercelRequest, res: VercelResponse, userId: string) {
  const { userLeadId, customContactId, subject, body, status = "draft", attachmentIds } = req.body ?? {};
  const safeAttachmentIds = Array.isArray(attachmentIds) ? attachmentIds.filter((id): id is string => typeof id === "string") : [];
  assertEmailContentWithinLimits(subject, body);
  if (!isAllowedStatus(status)) {
    throw new HttpError(400, `status must be one of ${ALLOWED_EMAIL_STATUSES.join(", ")}`);
  }

  if (!userLeadId && !customContactId) {
    throw new HttpError(400, "userLeadId or customContactId is required");
  }

  if (userLeadId) {
    const lead = await prisma.userLead.findUnique({
      where: { id: userLeadId },
      select: { id: true, userId: true, contactId: true },
    });
    if (!lead || lead.userId !== userId) throw new HttpError(404, "Lead not found");

    const email = await prisma.email.create({
      data: { userLeadId, contactId: lead.contactId ?? null, subject, body, status, attachmentIds: safeAttachmentIds },
    });
    invalidateEmailDashboardCache(userId)
    return res.status(201).json(email);
  }

  // customContactId path
  const cc = await prisma.customContact.findUnique({ where: { id: customContactId } });
  if (!cc || cc.userId !== userId) throw new HttpError(404, "Custom contact not found");

  const email = await prisma.email.create({
    data: { customContactId, subject, body, status, attachmentIds: safeAttachmentIds },
  });
  invalidateEmailDashboardCache(userId)
  res.status(201).json(email);
}

async function update(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id, subject, body, status, sentAt, attachmentIds } = req.body ?? {};
  if (!id) throw new HttpError(400, "id is required");
  assertEmailContentWithinLimits(subject, body);
  if (status && !isAllowedStatus(status)) {
    throw new HttpError(400, `status must be one of ${ALLOWED_EMAIL_STATUSES.join(", ")}`);
  }

  const existing = await prisma.email.findUnique({
    where: { id },
    include: {
      userLead: { select: { userId: true } },
      customContact: { select: { userId: true } },
    },
  });

  const ownerUserId = existing?.userLead?.userId ?? existing?.customContact?.userId ?? null;
  if (!existing || ownerUserId !== userId) {
    throw new HttpError(404, "Email not found");
  }

  const email = await prisma.email.update({
    where: { id },
    data: {
      ...(subject !== undefined && { subject }),
      ...(body !== undefined && { body }),
      ...(status && { status }),
      ...(sentAt && { sentAt: new Date(sentAt) }),
      ...(attachmentIds !== undefined && { attachmentIds: Array.isArray(attachmentIds) ? attachmentIds.filter((id): id is string => typeof id === "string") : [] }),
    },
  });

  invalidateEmailDashboardCache(userId)
  res.status(200).json(email);
}

async function remove(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id, ids } = req.query as { id?: string; ids?: string };

  const targetIds: string[] = ids
    ? ids.split(",").map(s => s.trim()).filter(Boolean)
    : id
    ? [id]
    : [];

  if (!targetIds.length) throw new HttpError(400, "id or ids is required");

  const emails = await prisma.email.findMany({
    where: { id: { in: targetIds } },
    include: {
      userLead: { select: { userId: true } },
      customContact: { select: { userId: true } },
    },
  });

  const ownedIds = emails
    .filter(e => (e.userLead?.userId ?? e.customContact?.userId) === userId)
    .map(e => e.id);

  if (!ownedIds.length) throw new HttpError(404, "Email not found");

  await prisma.email.deleteMany({ where: { id: { in: ownedIds } } });
  invalidateEmailDashboardCache(userId)
  res.status(200).json({ deleted: ownedIds });
}
