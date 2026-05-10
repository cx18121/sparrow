import { createHmac, timingSafeEqual } from "crypto";
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

const CLOCK_SKEW_SECONDS = 30;

// Verify a Supabase JWT locally using HMAC-SHA256 — no network call needed.
// Returns the user ID (sub claim) or null if the token is invalid/expired.
function verifyJwtLocally(token: string, secret: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;

    // Validate alg before trusting anything else.
    const header = JSON.parse(
      Buffer.from(headerB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    if (header.alg !== "HS256") return null;

    const signingInput = `${headerB64}.${payloadB64}`;
    const expected = createHmac("sha256", secret).update(signingInput).digest();
    const actual = Buffer.from(
      sigB64.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    );

    if (expected.length !== actual.length) return null;
    if (!timingSafeEqual(expected, actual)) return null;

    const payload = JSON.parse(
      Buffer.from(
        payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf8")
    );

    // exp is mandatory — reject tokens that omit it.
    if (typeof payload.exp !== "number") return null;
    // Allow a small clock-skew window.
    if (payload.exp + CLOCK_SKEW_SECONDS < Math.floor(Date.now() / 1000)) return null;

    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

// Verifies the Authorization: Bearer <jwt> header and returns the user id,
// or null if the token is missing/invalid.
//
// Uses local HMAC-SHA256 when SUPABASE_JWT_SECRET is set — eliminates the
// round-trip to Supabase Auth that was causing intermittent 401s. Falls back
// to auth.getUser() if the secret is not configured.
export async function getUserIdFromRequest(
  req: VercelRequest
): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;

  const token = auth.slice("Bearer ".length);

  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (jwtSecret) {
    return verifyJwtLocally(token, jwtSecret);
  }

  // Fallback: validate via Supabase Auth API (requires network call).
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
