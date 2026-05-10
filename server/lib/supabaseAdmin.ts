import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAuthRetryableFetchError } from "@supabase/auth-js";
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

// Verifies the Authorization: Bearer <jwt> header against Supabase Auth and
// returns the user id, or null if the token is missing/invalid/expired.
//
// Throws (rather than returning null) on transient network failures so the
// calling route returns 5xx instead of 401 — prevents the client from
// treating a Supabase Auth outage as "sign in again".
export async function getUserIdFromRequest(req: VercelRequest): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length);
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error) {
    if (isAuthRetryableFetchError(error)) {
      // Network blip or Supabase Auth outage — let the route return 5xx.
      throw error;
    }
    return null;
  }
  return data.user?.id ?? null;
}
