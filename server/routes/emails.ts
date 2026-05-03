import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { HttpError } from "../lib/user.js";

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

const ALLOWED_EMAIL_STATUSES = ["draft", "sent", "failed"] as const;
type EmailStatus = (typeof ALLOWED_EMAIL_STATUSES)[number];

// In-process cache for the combined dashboard query. Persists across warm invocations
// within the same function container, so repeat loads skip the DB entirely.
const DASHBOARD_CACHE_TTL = 30_000 // 30 seconds
declare global { var __dashCache: Map<string, { data: unknown; ts: number }> | undefined }
globalThis.__dashCache ??= new Map()

function getDashCache(userId: string) {
  const entry = globalThis.__dashCache!.get(userId)
  if (!entry || Date.now() - entry.ts > DASHBOARD_CACHE_TTL) return null
  return entry.data
}
function setDashCache(userId: string, data: unknown) {
  globalThis.__dashCache!.set(userId, { data, ts: Date.now() })
  // Evict oldest entries if the map grows too large (many users on one instance)
  if (globalThis.__dashCache!.size > 500) {
    const oldest = [...globalThis.__dashCache!.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, 100)
    oldest.forEach(([k]) => globalThis.__dashCache!.delete(k))
  }
}
function invalidateDashCache(userId: string) {
  globalThis.__dashCache!.delete(userId)
}

async function list(req: VercelRequest, res: VercelResponse, userId: string) {
  const { userLeadId, status, limit = "50", cursor, countToday, combined } = req.query as Record<
    string,
    string | undefined
  >;

  if (countToday === "true") {
    const startOfToday = new Date()
    startOfToday.setUTCHours(0, 0, 0, 0)
    const [fromLeads, fromContacts] = await Promise.all([
      prisma.email.count({ where: { status: "sent", sentAt: { gte: startOfToday }, userLead: { userId } } }),
      prisma.email.count({ where: { status: "sent", sentAt: { gte: startOfToday }, customContact: { userId } } }),
    ])
    return res.status(200).json({ count: fromLeads + fromContacts })
  }

  if (status && !ALLOWED_EMAIL_STATUSES.includes(status as any)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${ALLOWED_EMAIL_STATUSES.join(", ")}` });
  }

  const take = Math.min(parseInt(limit ?? "50", 10) || 50, 200);

  const include = {
    contact: { select: { id: true, name: true, email: true, title: true } },
    customContact: { select: { id: true, name: true, email: true, title: true, companyName: true } },
    userLead: {
      select: {
        id: true,
        status: true,
        company: { select: { id: true, name: true, domain: true } },
      },
    },
  } as const;

  // Dashboard combined fetch: drafts + sent in one round trip to avoid two cold starts.
  if (combined === "true") {
    // Serve from in-process cache on warm invocations; browser gets stale-while-revalidate.
    const cached = getDashCache(userId)
    if (cached) {
      res.setHeader("Cache-Control", "private, max-age=0, stale-while-revalidate=3600")
      return res.status(200).json(cached)
    }

    const branchWhere = (relation: "userLead" | "customContact", s: string) => ({ [relation]: { userId }, status: s });
    const [draftLeads, draftContacts, sentLeads, sentContacts] = await Promise.all([
      prisma.email.findMany({ where: branchWhere("userLead", "draft"), take: 9, orderBy: { createdAt: "desc" }, include }),
      prisma.email.findMany({ where: branchWhere("customContact", "draft"), take: 9, orderBy: { createdAt: "desc" }, include }),
      prisma.email.findMany({ where: branchWhere("userLead", "sent"), take: 21, orderBy: { createdAt: "desc" }, include }),
      prisma.email.findMany({ where: branchWhere("customContact", "sent"), take: 21, orderBy: { createdAt: "desc" }, include }),
    ]);
    const sort = (a: { createdAt: Date }, b: { createdAt: Date }) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    const drafts = [...draftLeads, ...draftContacts].sort(sort).slice(0, 8);
    const sent = [...sentLeads, ...sentContacts].sort(sort).slice(0, 20);
    const result = { drafts, sent }
    setDashCache(userId, result)
    res.setHeader("Cache-Control", "private, max-age=0, stale-while-revalidate=3600")
    return res.status(200).json(result)
  }

  // When scoped to a specific lead, only one branch applies — single query with cursor support.
  if (userLeadId) {
    const items = await prisma.email.findMany({
      where: { userLeadId, userLead: { userId }, ...(status && { status }) },
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: "desc" },
      include,
    });
    const hasMore = items.length > take;
    const trimmed = hasMore ? items.slice(0, take) : items;
    return res.status(200).json({ items: trimmed, nextCursor: hasMore ? trimmed[trimmed.length - 1]?.id : null });
  }

  // Two parallel queries avoid an OR across JOIN paths which prevents index use.
  const branchWhere = (relation: "userLead" | "customContact") => ({
    [relation]: { userId },
    ...(status && { status }),
  });

  const [fromLeads, fromContacts] = await Promise.all([
    prisma.email.findMany({ where: branchWhere("userLead"), take: take + 1, orderBy: { createdAt: "desc" }, include }),
    prisma.email.findMany({ where: branchWhere("customContact"), take: take + 1, orderBy: { createdAt: "desc" }, include }),
  ]);

  const merged = [...fromLeads, ...fromContacts]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, take + 1);

  const hasMore = merged.length > take;
  const trimmed = hasMore ? merged.slice(0, take) : merged;
  res.status(200).json({ items: trimmed, nextCursor: hasMore ? trimmed[trimmed.length - 1]?.id : null });
}

async function create(req: VercelRequest, res: VercelResponse, userId: string) {
  const { userLeadId, customContactId, subject, body, status = "draft", attachmentIds } = req.body ?? {};
  const safeAttachmentIds = Array.isArray(attachmentIds) ? attachmentIds.filter((id): id is string => typeof id === "string") : [];
  if (!ALLOWED_EMAIL_STATUSES.includes(status as EmailStatus)) {
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
    invalidateDashCache(userId)
    return res.status(201).json(email);
  }

  // customContactId path
  const cc = await prisma.customContact.findUnique({ where: { id: customContactId } });
  if (!cc || cc.userId !== userId) throw new HttpError(404, "Custom contact not found");

  const email = await prisma.email.create({
    data: { customContactId, subject, body, status, attachmentIds: safeAttachmentIds },
  });
  invalidateDashCache(userId)
  res.status(201).json(email);
}

async function update(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id, subject, body, status, sentAt, attachmentIds } = req.body ?? {};
  if (!id) throw new HttpError(400, "id is required");
  if (status && !ALLOWED_EMAIL_STATUSES.includes(status as EmailStatus)) {
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

  invalidateDashCache(userId)
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
  invalidateDashCache(userId)
  res.status(200).json({ deleted: ownedIds });
}
