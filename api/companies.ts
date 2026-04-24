import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "./_lib/prisma.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    region,
    batch,
    industry,
    isHiring,
    search,
    sort,
    limit = "50",
    cursor,
    withContact,
  } = req.query as Record<string, string | undefined>;

  const take = Math.min(parseInt(limit ?? "50", 10) || 50, 200);

  try {
    const companies = await prisma.company.findMany({
      where: {
        source: "yc",
        ...(region && { region }),
        ...(batch && { batch }),
        ...(industry && { industry }),
        ...(isHiring && { isHiring: isHiring === "true" }),
        ...(search && {
          name: { startsWith: search, mode: "insensitive" },
        }),
      },
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: sort === "name" ? { name: "asc" } : { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        domain: true,
        oneLiner: true,
        website: true,
        industry: true,
        region: true,
        stage: true,
        batch: true,
        isHiring: true,
        source: true,
        _count: { select: { contacts: true } },
        ...(withContact === "1" && {
          contacts: {
            take: 1,
            where: { email: { not: null } },
            orderBy: { lastVerifiedAt: "desc" },
            select: { id: true, name: true, email: true, title: true, role: true },
          },
        }),
      },
    });

    const hasMore = companies.length > take;
    const items = hasMore ? companies.slice(0, take) : companies;
    const nextCursor = hasMore ? items[items.length - 1]?.id : null;

    res.status(200).json({ items, nextCursor });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
