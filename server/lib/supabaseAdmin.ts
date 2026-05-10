import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAuthRetryableFetchError } from "@supabase/auth-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

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

export type AuthFailure = {
  reason: 'missing_header' | 'malformed_token' | 'invalid_token' | 'expired_token' | 'user_not_found';
  detail?: string;
  supabaseCode?: string;
};

// Verifies the Authorization: Bearer <jwt> header against Supabase Auth and
// returns the user id, or null if the token is missing/invalid/expired.
//
// Throws (rather than returning null) on transient network failures so the
// calling route returns 5xx instead of 401 — prevents the client from
// treating a Supabase Auth outage as "sign in again".
//
// On failure, also stashes diagnostic detail on the request as
// (req as any).__authFailure so respondUnauthorized() can surface it.
export async function getUserIdFromRequest(req: VercelRequest): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    stashFailure(req, { reason: 'missing_header' });
    return null;
  }
  const token = auth.slice("Bearer ".length);
  if (!token || token.split('.').length !== 3) {
    stashFailure(req, { reason: 'malformed_token' });
    return null;
  }
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error) {
    if (isAuthRetryableFetchError(error)) {
      throw error;
    }
    const msg = error.message ?? '';
    const reason: AuthFailure['reason'] = /expired/i.test(msg) ? 'expired_token' : 'invalid_token';
    stashFailure(req, { reason, detail: msg, supabaseCode: (error as any).code });
    console.warn(`[auth] ${req.method} ${req.url} 401: ${reason} — ${msg}`);
    return null;
  }
  if (!data.user?.id) {
    stashFailure(req, { reason: 'user_not_found' });
    return null;
  }
  return data.user.id;
}

function stashFailure(req: VercelRequest, f: AuthFailure) {
  (req as any).__authFailure = f;
}

// Sends a 401 with the diagnostic detail attached by getUserIdFromRequest.
// Routes that adopt this give the user a specific reason; routes still using
// the bare "Unauthorized" body keep working unchanged.
export function respondUnauthorized(req: VercelRequest, res: VercelResponse) {
  const f: AuthFailure | undefined = (req as any).__authFailure;
  return res.status(401).json({
    error: 'Unauthorized',
    reason: f?.reason ?? 'unknown',
    detail: f?.detail,
    supabaseCode: f?.supabaseCode,
  });
}
