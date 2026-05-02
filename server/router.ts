import type { VercelRequest, VercelResponse } from "@vercel/node";

import apolloSearch from "./routes/apollo-search.js";
import campaignBatch from "./routes/campaign-batch.js";
import campaignLeads from "./routes/campaign-leads.js";
import campaignOptions from "./routes/campaign-options.js";
import campaigns from "./routes/campaigns.js";
import companies from "./routes/companies.js";
import contacts from "./routes/contacts.js";
import customContacts from "./routes/custom-contacts.js";
import emails from "./routes/emails.js";
import generateEmail from "./routes/emails/generate.js";
import sendEmail from "./routes/emails/send.js";
import googleCallback from "./routes/google/callback.js";
import googleConnect from "./routes/google/connect.js";
import health from "./routes/health.js";
import industries from "./routes/industries.js";
import leads from "./routes/leads.js";
import profile from "./routes/profile.js";
import templates from "./routes/templates.js";
import styleGuide from "./routes/style-guide.js";

export type ApiHandler = (req: VercelRequest, res: VercelResponse) => Promise<unknown> | unknown;

export const routeHandlers: Record<string, ApiHandler> = {
  "/api/health": health,
  "/api/profile": profile,
  "/api/companies": companies,
  "/api/contacts": contacts,
  "/api/custom-contacts": customContacts,
  "/api/leads": leads,
  "/api/emails": emails,
  "/api/emails/generate": generateEmail,
  "/api/emails/send": sendEmail,
  "/api/google/connect": googleConnect,
  "/api/google/callback": googleCallback,
  "/api/templates": templates,
  "/api/campaigns": campaigns,
  "/api/campaign-batch": campaignBatch,
  "/api/campaign-leads": campaignLeads,
  "/api/campaign-options": campaignOptions,
  "/api/apollo-search": apolloSearch,
  "/api/industries": industries,
  "/api/style-guide": styleGuide,
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
