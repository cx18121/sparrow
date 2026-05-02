import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getProductionConfigErrors } from "../lib/env.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const missing = getProductionConfigErrors();
  if (missing.length > 0) {
    return res.status(503).json({ ok: false, error: "Production configuration is incomplete" });
  }
  res.status(200).json({ ok: true });
}
