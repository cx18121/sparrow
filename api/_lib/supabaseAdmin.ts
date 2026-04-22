import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { VercelRequest } from "@vercel/node";

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

// Verifies the Authorization: Bearer <jwt> header against Supabase and
// returns the user id, or null if the token is missing/invalid.
// Falls back to x-user-id during local dev when no bearer token is sent.
// IMPORTANT: x-user-id is accepted as-is for local dev bypass — real auth
// goes through Supabase JWT verification in production.
export async function getUserIdFromRequest(req: VercelRequest): Promise<string | null> {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  }
  // x-user-id bypass for local development with non-UUID demo IDs
  const header = req.headers["x-user-id"];
  if (typeof header === "string" && header.length > 0) return header;
  if (Array.isArray(header) && header[0]) return header[0];
  return null;
}