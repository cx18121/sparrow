import type { VercelRequest } from "@vercel/node";
import { createHmac, timingSafeEqual } from "node:crypto";

export const GOOGLE_GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
];

type GoogleConnectState = {
  userId: string;
  returnTo: string;
  redirectUri: string;
  iat: number;
};

function getStateSecret(): string {
  const secret =
    process.env.GOOGLE_OAUTH_STATE_SECRET ??
    process.env.GOOGLE_OAUTH_SECRET ??
    process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error("GOOGLE_OAUTH_STATE_SECRET, GOOGLE_OAUTH_SECRET, or ENCRYPTION_KEY is not set");
  return secret;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function sign(payload: string): string {
  return base64Url(createHmac("sha256", getStateSecret()).update(payload).digest());
}

export function getRequestBaseUrl(req: VercelRequest): string {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) return origin;

  const referer = req.headers.referer;
  const refererValue = Array.isArray(referer) ? referer[0] : referer;
  if (refererValue) {
    try {
      return new URL(refererValue).origin;
    } catch {
      // Fall back to forwarded host below.
    }
  }

  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const hostValue = Array.isArray(host) ? host[0] : host;
  if (!hostValue) throw new Error("Could not determine request host");

  const explicitAppOrigin = process.env.APP_ORIGIN ?? process.env.PUBLIC_APP_ORIGIN;
  if (explicitAppOrigin) return explicitAppOrigin.replace(/\/+$/, "");

  const proto = req.headers["x-forwarded-proto"];
  const protoValue = Array.isArray(proto) ? proto[0] : proto;
  const inferredProto =
    protoValue ?? (hostValue.startsWith("localhost") || hostValue.startsWith("127.0.0.1") ? "http" : "https");
  return `${inferredProto}://${hostValue}`;
}

export function getOriginFromRedirectUri(redirectUri: string): string {
  return new URL(redirectUri).origin;
}

export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/settings";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/api/")) return "/settings";
  return value;
}

export function encodeGoogleConnectState(state: GoogleConnectState): string {
  const payload = base64Url(JSON.stringify(state));
  return `${payload}.${sign(payload)}`;
}

export function decodeGoogleConnectState(value: unknown): GoogleConnectState | null {
  if (typeof value !== "string") return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(payload)) as GoogleConnectState;
    if (!parsed.userId || !parsed.returnTo || !parsed.redirectUri || !parsed.iat) return null;
    if (Date.now() - parsed.iat > 10 * 60 * 1000) return null;
    return { ...parsed, returnTo: sanitizeReturnTo(parsed.returnTo) };
  } catch {
    return null;
  }
}

export function withGoogleConnectResult(returnTo: string, params: Record<string, string>): string {
  const url = new URL(returnTo, "https://coldflow.local");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return `${url.pathname}${url.search}`;
}
