import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../lib/prisma.js";

const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = Array.isArray(req.query.emailId) ? req.query.emailId[0] : req.query.emailId ?? "";
  const emailId = raw.replace(/\.png$/i, "");

  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.status(200).end(TRANSPARENT_GIF);

  if (!emailId) return;

  try {
    await prisma.email.updateMany({
      where: { id: emailId, openedAt: null },
      data: { openedAt: new Date() },
    });
    await prisma.email.updateMany({
      where: { id: emailId },
      data: { openCount: { increment: 1 } },
    });
  } catch {
    // Fire-and-forget — pixel already returned
  }
}
