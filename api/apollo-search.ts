import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "./_lib/prisma.js";
import { getUserIdFromRequest } from "./_lib/supabaseAdmin.js";
import { HttpError } from "./_lib/user.js";
import axios from "axios";

const SEARCH_URL = "https://api.apollo.io/api/v1/mixed_people/api_search";
const MATCH_URL = "https://api.apollo.io/api/v1/people/match";

const TARGET_TITLES = [
  "CTO", "Founder", "Co-Founder", "CEO",
  "Head of Engineering", "VP Engineering",
];

function buildHeaders(apiKey: string) {
  return {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (req.method === "GET") return searchCompanies(req, res);
    if (req.method === "POST") return apolloSearch(req, res);
    if (req.method === "PUT") return revealContact(req, res);

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: (err as Error).message });
  }
}

async function revealContact(req: VercelRequest, res: VercelResponse) {
  const { personId } = req.body ?? {};
  if (!personId) throw new HttpError(400, "personId is required");

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new HttpError(500, "APOLLO_API_KEY is not configured");

  const revealed = await revealAndSaveContact(personId, personId, apiKey);
  if (!revealed) {
    return res.status(200).json({ revealed: false });
  }
  return res.status(200).json({
    revealed: true,
    contact: {
      name: revealed.name,
      email: revealed.email,
      title: revealed.title,
      linkedinUrl: revealed.linkedinUrl,
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
      source: "yc",
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

async function apolloSearch(req: VercelRequest, res: VercelResponse) {
  const { domain, companyId } = req.body ?? {};
  if (!domain) throw new HttpError(400, "domain is required");

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new HttpError(500, "APOLLO_API_KEY is not configured");

  try {
    const response = await axios.post(
      SEARCH_URL,
      {
        q_organization_domains_list: [domain],
        person_titles: TARGET_TITLES,
        per_page: 10,
      },
      { headers: buildHeaders(apiKey) }
    );

    const people = (response.data.people ?? []) as Array<{
      id: string;
      first_name: string;
      last_name_obfuscated: string;
      title: string;
      has_email: boolean;
      organization: { name: string } | null;
    }>;

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
      return res.status(status ?? 500).json({
        error: `Apollo API error: ${err.response?.status} ${err.message}`,
      });
    }
    return res.status(500).json({ error: (err as Error).message });
  }
}

export async function revealAndSaveContact(
  domain: string,
  personId: string,
  apiKey: string
): Promise<{
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string | null;
  emailStatus: string | null;
  title: string;
  linkedinUrl: string | null;
} | null> {
  try {
    const response = await axios.post(
      MATCH_URL,
      { id: personId, reveal_personal_emails: false },
      { headers: buildHeaders(apiKey) }
    );
    return response.data.person ?? null;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      return null;
    }
    return null;
  }
}
