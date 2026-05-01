import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "./_lib/prisma.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const [rows, hiringCount] = await Promise.all([
      prisma.company.groupBy({
        by: ["industry"],
        where: { industry: { not: null }, isVerified: true },
        _count: { industry: true },
        orderBy: { industry: "asc" },
      }),
      prisma.company.count({ where: { isHiring: true, isVerified: true } }),
    ]);

    const industries = rows
      .filter((r) => r.industry)
      .map((r) => ({ name: r.industry as string, count: r._count.industry }));

    res.status(200).json({ industries, hiringCount });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
