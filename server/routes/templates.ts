import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { HttpError } from "../lib/user.js";
import { parseBody } from "../lib/parse-params.js";
import { sendRouteError } from "../lib/route-error.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (req.method === "GET") return await list(req, res, userId);
    if (req.method === "POST") return await create(req, res, userId);
    if (req.method === "PATCH") return await update(req, res, userId);
    if (req.method === "DELETE") return await remove(req, res, userId);

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return sendRouteError(res, err);
  }
}

function trimLimited(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

async function list(_req: VercelRequest, res: VercelResponse, userId: string) {
  const items = await prisma.template.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  res.status(200).json({ items });
}

async function create(req: VercelRequest, res: VercelResponse, userId: string) {
  const body = parseBody(req);
  const { name, subject, body: content, verbatim } = body ?? {};
  if (typeof name !== "string" || typeof subject !== "string" || typeof content !== "string") {
    return res.status(400).json({ error: "name, subject, and body are required" });
  }
  if (name.length > 120 || subject.length > 300 || content.length > 50_000) {
    return res.status(400).json({ error: "Template fields are too large" });
  }

  const template = await prisma.template.create({
    data: {
      userId,
      name: trimLimited(name, 120),
      subject: trimLimited(subject, 300),
      body: content.slice(0, 50_000),
      isShared: false,
      verbatim: verbatim === true,
    },
  });
  res.status(201).json(template);
}

async function update(req: VercelRequest, res: VercelResponse, userId: string) {
  const body = parseBody(req);
  const { id, name, subject, body: content, verbatim } = body ?? {};
  if (typeof id !== "string") return res.status(400).json({ error: "id is required" });
  if (name !== undefined && typeof name !== "string") {
    return res.status(400).json({ error: "name must be a string" });
  }
  if (subject !== undefined && typeof subject !== "string") {
    return res.status(400).json({ error: "subject must be a string" });
  }
  if (content !== undefined && typeof content !== "string") {
    return res.status(400).json({ error: "body must be a string" });
  }
  if (verbatim !== undefined && typeof verbatim !== "boolean") {
    return res.status(400).json({ error: "verbatim must be a boolean" });
  }
  if (
    (typeof name === "string" && name.length > 120) ||
    (typeof subject === "string" && subject.length > 300) ||
    (typeof content === "string" && content.length > 50_000)
  ) {
    return res.status(400).json({ error: "Template fields are too large" });
  }

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
      ...(verbatim !== undefined && { verbatim }),
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
