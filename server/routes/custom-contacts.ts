import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (req.method === "GET") return list(req, res, userId);
    if (req.method === "POST") return create(req, res, userId);
    if (req.method === "DELETE") return remove(req, res, userId);

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}

async function list(_req: VercelRequest, res: VercelResponse, userId: string) {
  const items = await prisma.customContact.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  res.status(200).json({ items });
}

async function create(req: VercelRequest, res: VercelResponse, userId: string) {
  const { name, email, title, companyName } = req.body ?? {};
  if (!name && !email) {
    return res.status(400).json({ error: "At least a name or email is required" });
  }

  const contact = await prisma.customContact.create({
    data: { userId, name: name ?? null, email: email ?? null, title: title ?? null, companyName: companyName ?? null },
  });
  res.status(201).json(contact);
}

async function remove(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id } = req.query as Record<string, string | undefined>;
  if (!id) return res.status(400).json({ error: "id query param is required" });

  const existing = await prisma.customContact.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return res.status(404).json({ error: "Contact not found" });
  }

  await prisma.customContact.delete({ where: { id } });
  res.status(204).end();
}
