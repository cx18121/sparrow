import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";
import { prisma } from "../lib/prisma.js";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { HttpError } from "../lib/user.js";
import { searchContacts, revealPerson, normalizeDomain } from "../lib/apollo.js";
import { consumeDurableDailyQuota, QuotaError } from "../lib/rate-limit.js";

type ApolloAction = "search" | "reveal";

function quotaLimit(action: ApolloAction): number {
  const envName = action === "search" ? "APOLLO_SEARCH_DAILY_LIMIT" : "APOLLO_REVEAL_DAILY_LIMIT";
  const fallback = action === "search" ? 100 : 50;
  const parsed = Number(process.env[envName] ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : fallback;
}

async function consumeApolloQuota(userId: string, action: ApolloAction) {
  try {
    await consumeDurableDailyQuota("apollo", userId, action, quotaLimit(action));
  } catch (err) {
    if (err instanceof QuotaError) throw new HttpError(429, `Daily Apollo ${action} limit reached (${quotaLimit(action)}). Try again tomorrow.`);
    throw err;
  }
}

function requireApolloApiKey(): string {
  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) throw new HttpError(500, "APOLLO_API_KEY is not configured");
  return apiKey;
}

async function requireSearchableCompany(companyId: unknown, domain: unknown) {
  if (typeof companyId !== "string" || !companyId) throw new HttpError(400, "companyId is required");
  if (typeof domain !== "string" || !domain) throw new HttpError(400, "domain is required");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, domain: true, isVerified: true },
  });
  if (!company || !company.isVerified) throw new HttpError(404, "Company not found");
  if (normalizeDomain(company.domain) !== normalizeDomain(domain)) {
    throw new HttpError(400, "domain does not match companyId");
  }
  return company;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (req.method === "GET") return searchCompanies(req, res);
    if (req.method === "POST") return apolloSearch(req, res, userId);
    if (req.method === "PUT") return revealContact(req, res, userId);

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function revealContact(req: VercelRequest, res: VercelResponse, userId: string) {
  const { personId, companyId, domain } = req.body ?? {};
  if (!personId) throw new HttpError(400, "personId is required");
  const company = await requireSearchableCompany(companyId, domain);

  const apiKey = requireApolloApiKey();

  await consumeApolloQuota(userId, "reveal");
  const revealed = await revealPerson(personId, apiKey);
  if (!revealed) {
    return res.status(200).json({ revealed: false });
  }
  const revealedDomain = revealed.organization?.primary_domain
    ? normalizeDomain(revealed.organization.primary_domain)
    : null;
  if (revealedDomain && revealedDomain !== normalizeDomain(company.domain)) {
    throw new HttpError(403, "Apollo person does not belong to the requested company");
  }
  return res.status(200).json({
    revealed: true,
    contact: {
      name: revealed.name,
      email: revealed.email,
      title: revealed.title,
      linkedinUrl: revealed.linkedin_url,
    },
  });
}

async function searchCompanies(req: VercelRequest, res: VercelResponse) {
  const {
    search,
    region,
    industry,
    isHiring,
    limit = "50",
    cursor,
  } = req.query as Record<string, string | undefined>;

  const take = Math.min(parseInt(limit ?? "50", 10) || 50, 200);

  const companies = await prisma.company.findMany({
    where: {
      isVerified: true,
      ...(region && { region }),
      ...(industry && { industry }),
      ...(isHiring && { isHiring: isHiring === "true" }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { domain: { contains: search, mode: "insensitive" } },
          { oneLiner: { contains: search, mode: "insensitive" } },
        ],
      }),
    },
    take: take + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      domain: true,
      oneLiner: true,
      website: true,
      industry: true,
      region: true,
      stage: true,
      batch: true,
      isHiring: true,
      location: true,
      _count: { select: { contacts: true } },
    },
  });

  const hasMore = companies.length > take;
  const items = hasMore ? companies.slice(0, take) : companies;
  const nextCursor = hasMore ? items[items.length - 1]?.id : null;

  res.status(200).json({ items, nextCursor });
}

async function apolloSearch(req: VercelRequest, res: VercelResponse, userId: string) {
  const { domain, companyId } = req.body ?? {};
  const company = await requireSearchableCompany(companyId, domain);

  const apiKey = requireApolloApiKey();

  await consumeApolloQuota(userId, "search");
  try {
    const people = await searchContacts(company.domain, apiKey, { retry: false });

    const previews = people.map((p) => ({
      id: p.id,
      firstName: p.first_name,
      lastNameObfuscated: p.last_name_obfuscated,
      title: p.title,
      hasEmail: p.has_email,
      companyName: p.organization?.name ?? null,
    }));

    res.status(200).json({ previews, companyId });
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 429) {
        return res.status(429).json({
          error: "Apollo rate limit reached. Please wait a moment and try again.",
        });
      }
      return res.status(status ?? 500).json({ error: "Apollo API error" });
    }
    if (err instanceof HttpError) throw err;
    return res.status(500).json({ error: "Apollo API error" });
  }
}
