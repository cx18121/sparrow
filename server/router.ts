import type { VercelRequest, VercelResponse } from "@vercel/node";

import apolloSearch from "./routes/apollo-search.js";
import audienceQuery from "./routes/audience-query.js";
import campaignLeads from "./routes/campaign-leads.js";
import campaignOptions from "./routes/campaign-options.js";
import campaigns from "./routes/campaigns.js";
import companies from "./routes/companies.js";
import customContacts from "./routes/custom-contacts.js";
import emails from "./routes/emails.js";
import generateEmail from "./routes/emails/generate.js";
import changeEmailAngle from "./routes/emails/angle.js";
import sendEmail from "./routes/emails/send.js";
import sendTestEmail from "./routes/emails/send-test.js";
import googleCallback from "./routes/google/callback.js";
import googleConnect from "./routes/google/connect.js";
import googleWatchRenew from "./routes/google/watch-renew.js";
import health from "./routes/health.js";
import leads from "./routes/leads.js";
import account from "./routes/account.js";
import previewFitAngle from "./routes/preview-fit-angle.js";
import profile from "./routes/profile.js";
import templates from "./routes/templates.js";
import track from "./routes/track.js";
import gmailWebhook from "./routes/webhooks/gmail.js";
import devInjectReply from "./routes/dev/inject-reply.js";

export type ApiHandler = (req: VercelRequest, res: VercelResponse) => Promise<unknown> | unknown;

export const routeHandlers: Record<string, ApiHandler> = {
  "/api/health": health,
  "/api/account": account,
  "/api/profile": profile,
  "/api/companies": companies,
  "/api/custom-contacts": customContacts,
  "/api/leads": leads,
  "/api/emails": emails,
  "/api/emails/generate": generateEmail,
  "/api/emails/angle": changeEmailAngle,
  "/api/emails/send": sendEmail,
  "/api/emails/send-test": sendTestEmail,
  "/api/google/connect": googleConnect,
  "/api/google/callback": googleCallback,
  "/api/google/watch-renew": googleWatchRenew,
  "/api/webhooks/gmail": gmailWebhook,
  "/api/templates": templates,
  "/api/campaigns": campaigns,
  "/api/campaign-leads": campaignLeads,
  "/api/campaign-options": campaignOptions,
  "/api/apollo-search": apolloSearch,
  "/api/audience-query": audienceQuery,
  "/api/preview/fit-angle": previewFitAngle,
  // Dev-only — handler itself returns 404 when NODE_ENV=production so the
  // route is effectively non-existent in prod even though it's registered.
  "/api/dev/inject-reply": devInjectReply,
};

function pathFromCatchAll(req: VercelRequest): string | null {
  const path = req.query?.path;
  if (Array.isArray(path)) return `/api/${path.join("/")}`;
  if (typeof path === "string") return `/api/${path}`;
  return null;
}

export function getApiRoutePath(req: VercelRequest): string {
  const rawUrl = req.url ?? "";
  const pathname = rawUrl ? new URL(rawUrl, "http://sparrow.local").pathname : "";
  const routePath = pathname.startsWith("/api/") || pathname === "/api" ? pathname : pathFromCatchAll(req);
  const normalized = routePath || pathname || "/api";
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

export async function dispatchApiRequest(req: VercelRequest, res: VercelResponse) {
  const routePath = getApiRoutePath(req);

  // Handle dynamic tracking pixel route: /api/track/o/<emailId>.png
  if (routePath.startsWith("/api/track/o/")) {
    const emailId = routePath.slice("/api/track/o/".length);
    req.query = { ...req.query, emailId };
    return track(req, res);
  }

  const handler = routeHandlers[routePath];
  if (!handler) return res.status(404).json({ error: "Not found" });

  if (req.query && Object.prototype.hasOwnProperty.call(req.query, "path")) {
    delete req.query.path;
  }

  try {
    return await handler(req, res);
  } catch (err: unknown) {
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
}
