import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "./_lib/prisma.js";
import { getUserIdFromRequest } from "./_lib/supabaseAdmin.js";
import { HttpError } from "./_lib/user.js";

const ALLOWED_STATUSES = ["NEW", "SAVED", "EMAILED", "REJECTED"] as const;
type LeadStatus = (typeof ALLOWED_STATUSES)[number];

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
    return res.status(500).json({ error: (err as Error).message });
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
  const { companyId, contactId, notes } = req.body ?? {};
  if (!companyId) throw new HttpError(400, "companyId is required");

  const lead = await prisma.userLead.upsert({
    where: {
      userId_companyId_contactId: {
        userId,
        companyId,
        contactId: contactId ?? null,
      },
    },
    create: { userId, companyId, contactId: contactId ?? null, notes, status: "SAVED" },
    update: { notes },
  });

  res.status(201).json(lead);
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
