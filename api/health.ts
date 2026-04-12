import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "./_lib/prisma.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const [companies, contacts] = await Promise.all([
      prisma.company.count(),
      prisma.contact.count(),
    ]);
    res.status(200).json({ ok: true, companies, contacts });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
}
