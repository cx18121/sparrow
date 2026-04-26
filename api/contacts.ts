import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "./_lib/prisma.js";
import { getUserIdFromRequest } from "./_lib/supabaseAdmin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const {
    companyId,
    role,
    search,
    hasEmail,
    limit = "50",
    cursor,
  } = req.query as Record<string, string | undefined>;

  const take = Math.min(parseInt(limit ?? "50", 10) || 50, 200);

  try {
    const contacts = await prisma.contact.findMany({
      where: {
        ...(companyId && { companyId }),
        ...(role && { role }),
        ...(hasEmail === "true" && { email: { not: null } }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { title: { contains: search, mode: "insensitive" } },
          ],
        }),
      },
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        companyId: true,
        name: true,
        email: true,
        title: true,
        role: true,
        linkedinUrl: true,
        lastVerifiedAt: true,
        company: {
          select: { id: true, name: true, domain: true, industry: true, region: true },
        },
      },
    });

    const hasMore = contacts.length > take;
    const items = hasMore ? contacts.slice(0, take) : contacts;
    const nextCursor = hasMore ? items[items.length - 1]?.id : null;

    res.status(200).json({ items, nextCursor });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
