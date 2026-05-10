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
    await prisma.$executeRaw`
      UPDATE "Email"
      SET "openedAt" = COALESCE("openedAt", NOW()),
          "openCount" = "openCount" + 1
      WHERE id = ${emailId}
    `;
  } catch {
    // Fire-and-forget — pixel already returned
  }
}
