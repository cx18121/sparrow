import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "./_lib/prisma.js";
import { getUserIdFromRequest } from "./_lib/supabaseAdmin.js";
import { HttpError } from "./_lib/user.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (req.method === "GET") return list(req, res, userId);
    if (req.method === "POST") return create(req, res, userId);
    if (req.method === "PATCH") return update(req, res, userId);

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: (err as Error).message });
  }
}

async function list(req: VercelRequest, res: VercelResponse, userId: string) {
  const { userLeadId, status, limit = "50", cursor } = req.query as Record<
    string,
    string | undefined
  >;
  const take = Math.min(parseInt(limit ?? "50", 10) || 50, 200);

  const items = await prisma.email.findMany({
    where: {
      userLead: { userId },
      ...(userLeadId && { userLeadId }),
      ...(status && { status }),
    },
    take: take + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    orderBy: { createdAt: "desc" },
    include: {
      contact: { select: { id: true, name: true, email: true, title: true } },
      userLead: {
        select: {
          id: true,
          status: true,
          company: { select: { id: true, name: true, domain: true } },
        },
      },
    },
  });

  const hasMore = items.length > take;
  const trimmed = hasMore ? items.slice(0, take) : items;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1]?.id : null;

  res.status(200).json({ items: trimmed, nextCursor });
}

async function create(req: VercelRequest, res: VercelResponse, userId: string) {
  const { userLeadId, subject, body, status = "draft" } = req.body ?? {};
  if (!userLeadId) throw new HttpError(400, "userLeadId is required");

  const lead = await prisma.userLead.findUnique({
    where: { id: userLeadId },
    select: { id: true, userId: true, contactId: true },
  });
  if (!lead || lead.userId !== userId) throw new HttpError(404, "Lead not found");

  const email = await prisma.email.create({
    data: {
      userLeadId,
      contactId: lead.contactId ?? null,
      subject,
      body,
      status,
    },
  });

  res.status(201).json(email);
}

async function update(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id, subject, body, status, sentAt } = req.body ?? {};
  if (!id) throw new HttpError(400, "id is required");

  const existing = await prisma.email.findUnique({
    where: { id },
    include: { userLead: { select: { userId: true } } },
  });
  if (!existing || !existing.userLead || existing.userLead.userId !== userId) {
    throw new HttpError(404, "Email not found");
  }

  const email = await prisma.email.update({
    where: { id },
    data: {
      ...(subject !== undefined && { subject }),
      ...(body !== undefined && { body }),
      ...(status && { status }),
      ...(sentAt && { sentAt: new Date(sentAt) }),
    },
  });

  res.status(200).json(email);
}
