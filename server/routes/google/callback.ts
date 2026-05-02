import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { encrypt } from "../../lib/crypto.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import {
  decodeGoogleConnectState,
  getOriginFromRedirectUri,
  withGoogleConnectResult,
} from "../../lib/google-connect.js";

function redirect(res: VercelResponse, location: string) {
  res.setHeader("Location", location);
  return res.status(302).end();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const state = decodeGoogleConnectState(req.query.state);
  if (!state) return res.status(400).json({ error: "Invalid Google connection state" });

  const baseUrl = getOriginFromRedirectUri(state.redirectUri);
  const redirectToApp = (params: Record<string, string>) =>
    redirect(res, `${baseUrl}${withGoogleConnectResult(state.returnTo, params)}`);

  const oauthError = Array.isArray(req.query.error) ? req.query.error[0] : req.query.error;
  if (oauthError) return redirectToApp({ google_error: oauthError });

  const code = Array.isArray(req.query.code) ? req.query.code[0] : req.query.code;
  if (!code) return redirectToApp({ google_error: "missing_code" });

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return redirectToApp({ google_error: "missing_google_config" });
  }

  try {
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      state.redirectUri,
    );
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      return redirectToApp({ google_error: "missing_refresh_token" });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("user_profiles").upsert(
      {
        user_id: state.userId,
        google_refresh_token_encrypted: encrypt(tokens.refresh_token),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (error) {
      console.error("Google refresh token profile save failed", error);
      return redirectToApp({ google_error: "profile_save_failed" });
    }
    return redirectToApp({ google_connected: "1" });
  } catch (err) {
    console.error("Google connect callback failed", err);
    return redirectToApp({ google_error: "callback_failed" });
  }
}
