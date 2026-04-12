import type { VercelRequest } from "@vercel/node";

// Placeholder until Supabase auth is wired into API routes.
// Frontend should send `x-user-id` from the current session.
// When auth lands, replace with a Supabase JWT verifier.
export function getUserId(req: VercelRequest): string | null {
  const header = req.headers["x-user-id"];
  if (typeof header === "string" && header.length > 0) return header;
  if (Array.isArray(header) && header[0]) return header[0];
  return null;
}

export function requireUserId(req: VercelRequest): string {
  const id = getUserId(req);
  if (!id) {
    throw new HttpError(401, "Missing x-user-id");
  }
  return id;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
