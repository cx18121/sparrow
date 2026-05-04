import type { VercelResponse } from "@vercel/node";
import { HttpError } from "./user.js";

export function sendRouteError(
  res: VercelResponse,
  err: unknown,
  fallbackMessage = "Internal server error",
) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  return res.status(500).json({ error: fallbackMessage });
}
