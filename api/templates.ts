import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "./_lib/prisma.js";
import { getUserIdFromRequest } from "./_lib/supabaseAdmin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    if (req.method === "GET") return list(req, res, userId);
    if (req.method === "POST") return create(req, res, userId);
    if (req.method === "PATCH") return update(req, res, userId);
    if (req.method === "DELETE") return remove(req, res, userId);

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}

async function list(_req: VercelRequest, res: VercelResponse, userId: string) {
  const items = await prisma.template.findMany({
    where: {
      OR: [{ userId }, { isShared: true }],
    },
    orderBy: { updatedAt: "desc" },
  });
  res.status(200).json({ items });
}

async function create(req: VercelRequest, res: VercelResponse, userId: string) {
  const body = parseBody(req);
  const { name, subject, body: content, isShared } = body ?? {};
  if (!name || !subject || !content) {
    return res.status(400).json({ error: "name, subject, and body are required" });
  }

  const template = await prisma.template.create({
    data: {
      userId,
      name,
      subject,
      body: content,
      isShared: !!isShared,
    },
  });
  res.status(201).json(template);
}

async function update(req: VercelRequest, res: VercelResponse, userId: string) {
  const body = parseBody(req);
  const { id, name, subject, body: content, isShared } = body ?? {};
  if (!id) return res.status(400).json({ error: "id is required" });

  const existing = await prisma.template.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return res.status(404).json({ error: "Template not found" });
  }

  const template = await prisma.template.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(subject !== undefined && { subject }),
      ...(content !== undefined && { body: content }),
      ...(isShared !== undefined && { isShared: !!isShared }),
    },
  });
  res.status(200).json(template);
}

async function remove(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id } = req.query as Record<string, string | undefined>;
  if (!id) return res.status(400).json({ error: "id query param is required" });

  const existing = await prisma.template.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return res.status(404).json({ error: "Template not found" });
  }

  await prisma.template.delete({ where: { id } });
  res.status(204).end();
}

function parseBody(req: VercelRequest): Record<string, unknown> | null {
  if (!req.body) return null;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return req.body as Record<string, unknown>;
}
