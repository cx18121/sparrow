import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "./_lib/prisma.js";
import { getUserIdFromRequest } from "./_lib/supabaseAdmin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [industries, regions, stages, batches] = await Promise.all([
      prisma.company.findMany({
        where: { source: "yc", industry: { not: null } },
        distinct: ["industry"],
        select: { industry: true },
        orderBy: { industry: "asc" },
      }),
      prisma.company.findMany({
        where: { source: "yc", region: { not: null } },
        distinct: ["region"],
        select: { region: true },
        orderBy: { region: "asc" },
      }),
      prisma.company.findMany({
        where: { source: "yc", stage: { not: null } },
        distinct: ["stage"],
        select: { stage: true },
        orderBy: { stage: "asc" },
      }),
      prisma.company.findMany({
        where: { source: "yc", batch: { not: null } },
        distinct: ["batch"],
        select: { batch: true },
        orderBy: { batch: "desc" },
      }),
    ]);

    res.status(200).json({
      industries: industries.map(c => c.industry).filter(Boolean) as string[],
      regions: regions.map(c => c.region).filter(Boolean) as string[],
      stages: stages.map(c => c.stage).filter(Boolean) as string[],
      batches: batches.map(c => c.batch).filter(Boolean) as string[],
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
