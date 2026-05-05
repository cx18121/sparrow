import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { HttpError } from "../lib/user.js";
import { revealAndUpsertContact } from "../lib/apollo-enrichment.js";
import { QuotaError } from "../lib/rate-limit.js";

const ALLOWED_STATUSES = ["SAVED", "EMAILED", "NO_RESPONSE", "DECLINED"] as const;
type LeadStatus = (typeof ALLOWED_STATUSES)[number];

function leadLockKey(userId: string, companyId: string, contactId: string | null) {
  return `lead:${userId}:${companyId}:${contactId ?? "no-contact"}`;
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
  const { status, limit = "50", cursor } = req.query as Record<string, string | undefined>;
  const take = Math.min(parseInt(limit ?? "50", 10) || 50, 200);

  const items = await prisma.userLead.findMany({
    where: {
      userId,
      ...(status && ALLOWED_STATUSES.includes(status as LeadStatus) && { status: status as LeadStatus }),
    },
    take: take + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    orderBy: { addedAt: "desc" },
    include: {
      company: {
        select: { id: true, name: true, domain: true, oneLiner: true, industry: true, region: true },
      },
      contact: {
        select: { id: true, name: true, email: true, title: true, role: true },
      },
    },
  });

  const hasMore = items.length > take;
  const trimmed = hasMore ? items.slice(0, take) : items;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1]?.id : null;

  res.status(200).json({ items: trimmed, nextCursor });
}

async function create(req: VercelRequest, res: VercelResponse, userId: string) {
  const { companyId, contactId, notes, apolloPersonId } = req.body ?? {};
  if (!companyId) throw new HttpError(400, "companyId is required");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  });
  if (!company) throw new HttpError(404, "Company not found");

  if (contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { companyId: true },
    });
    if (!contact || contact.companyId !== companyId) {
      throw new HttpError(404, "Contact not found for this company");
    }
  }

  let resolvedContactId = contactId ?? null;

  // If an Apollo person ID is provided, reveal the contact and upsert it now
  // so the saved lead has email/title available immediately.
  if (apolloPersonId && !contactId) {
    const apolloKey = process.env.APOLLO_API_KEY;
    if (apolloKey) {
      try {
        const saved = await revealAndUpsertContact(apolloPersonId, companyId, apolloKey, userId);
        if (saved) resolvedContactId = saved.id;
      } catch (err) {
        if (err instanceof QuotaError) throw new HttpError(429, "Daily Apollo reveal limit reached. Try again tomorrow.");
        console.warn("Apollo reveal failed during save:", err);
      }
    }
  }

  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${leadLockKey(userId, companyId, resolvedContactId)}))`;

    const existing = await tx.userLead.findFirst({
      where: { userId, companyId, contactId: resolvedContactId },
    });

    if (existing) {
      const updated = await tx.userLead.update({
        where: { id: existing.id },
        data: { notes, ...(apolloPersonId && { apolloPersonId }) },
      });
      return { lead: updated, status: 200 };
    }

    const lead = await tx.userLead.create({
      data: { userId, companyId, contactId: resolvedContactId, notes, apolloPersonId: apolloPersonId ?? null, status: "SAVED" },
    });
    return { lead, status: 201 };
  });

  res.status(result.status).json(result.lead);
}


async function update(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id, status, notes } = req.body ?? {};
  if (!id) throw new HttpError(400, "id is required");
  if (status && !ALLOWED_STATUSES.includes(status)) {
    throw new HttpError(400, `status must be one of ${ALLOWED_STATUSES.join(", ")}`);
  }

  const existing = await prisma.userLead.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    throw new HttpError(404, "Lead not found");
  }

  const lead = await prisma.userLead.update({
    where: { id },
    data: {
      ...(status && { status }),
      ...(notes !== undefined && { notes }),
    },
  });

  res.status(200).json(lead);
}

async function remove(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id } = req.query as Record<string, string | undefined>;
  if (!id) throw new HttpError(400, "id query param is required");

  const existing = await prisma.userLead.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    throw new HttpError(404, "Lead not found");
  }

  await prisma.userLead.delete({ where: { id } });
  res.status(204).end();
}
