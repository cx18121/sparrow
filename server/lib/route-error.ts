import type { VercelResponse } from "@vercel/node";
import { HttpError } from "./user.js";

export function sendRouteError(
  res: VercelResponse,
  err: unknown,
  fallbackMessage = "An unexpected error occurred",
) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  // Log unexpected errors so they're visible in server/Vercel logs.
  console.error("[route-error] Unhandled exception:", err);
  return res.status(500).json({ error: fallbackMessage });
}
