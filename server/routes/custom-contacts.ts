import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { HttpError } from "../lib/user.js";
import { parseBody } from "../lib/parse-params.js";
import { sendRouteError } from "../lib/route-error.js";
import { attachCustomContactToCampaign } from "../lib/campaign-membership.js";

const VALID_STATUSES = new Set(["SAVED", "EMAILED", "NO_RESPONSE", "DECLINED"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function optionalString(value: unknown, fieldName: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, `${fieldName} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new HttpError(400, `${fieldName} is too long`);
  return trimmed || null;
}

function optionalEmail(value: unknown): string | null {
  const email = optionalString(value, "email", 320);
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, "email must be valid");
  return email?.toLowerCase() ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (req.method === "GET") return await list(req, res, userId);
    if (req.method === "POST") return await create(req, res, userId);
    if (req.method === "PATCH") return await update(req, res, userId);
    if (req.method === "DELETE") return await remove(req, res, userId);

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return sendRouteError(res, err);
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
  const body = parseBody(req) ?? {};
  const { name, email, title, companyName, campaignId } = body;
  const safeName = optionalString(name, "name", 200);
  const safeEmail = optionalEmail(email);
  const safeTitle = optionalString(title, "title", 200);
  const safeCompanyName = optionalString(companyName, "companyName", 200);
  if (!safeName && !safeEmail) {
    return res.status(400).json({ error: "At least a name or email is required" });
  }

  const contact = await prisma.customContact.create({
    data: { userId, name: safeName, email: safeEmail, title: safeTitle, companyName: safeCompanyName },
  });

  if (typeof campaignId === "string" && campaignId.length > 0) {
    try {
      const link = await attachCustomContactToCampaign(campaignId, contact.id, userId);
      return res.status(201).json({ ...contact, campaignCustomContactId: link.id });
    } catch (err) {
      // Roll the contact back if we couldn't attach it — otherwise the user
      // sees a "saved" contact in the global pool that they didn't ask for.
      await prisma.customContact.delete({ where: { id: contact.id } }).catch(() => {});
      throw err;
    }
  }

  res.status(201).json(contact);
}

async function update(req: VercelRequest, res: VercelResponse, userId: string) {
  const { id, status } = parseBody(req) ?? {};
  if (!id) return res.status(400).json({ error: "id is required" });
  if (status !== undefined && !VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(", ")}` });
  }

  const existing = await prisma.customContact.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return res.status(404).json({ error: "Contact not found" });
  }

  const updated = await prisma.customContact.update({
    where: { id },
    data: { ...(status ? { status } : {}) },
  });
  res.status(200).json(updated);
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
