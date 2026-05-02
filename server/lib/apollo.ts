import axios from "axios";

// Single Apollo HTTP module. All search/reveal/health primitives live here with
// shared headers, retry, and error logging. Imports nothing from Prisma so it
// is safe to load from CLI scripts without spinning up a serverless DB client.

// Strips protocol, www prefix, and path so callers can pass raw website URLs
// or already-clean domains interchangeably.
export function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}
//
// Search calls (searchContacts, searchOrganization) are FREE.
// Reveal calls (revealPerson, enrichDomain) consume one Apollo credit each.

const SEARCH_URL = "https://api.apollo.io/api/v1/mixed_people/api_search";
const MATCH_URL = "https://api.apollo.io/api/v1/people/match";
const ORG_SEARCH_URL = "https://api.apollo.io/api/v1/mixed_companies/search";
const HEALTH_URL = "https://api.apollo.io/v1/auth/health";

const TARGET_TITLES = [
  "CTO",
  "Founder",
  "Co-Founder",
  "CEO",
  "Head of Engineering",
  "VP Engineering",
];

export interface ApolloSearchResult {
  id: string;
  first_name: string;
  last_name_obfuscated: string;
  title: string;
  has_email: boolean;
  organization: { name: string } | null;
}

export interface ApolloRevealedPerson {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  email: string | null;
  email_status: string | null;
  title: string;
  linkedin_url: string | null;
  organization: { name: string; primary_domain: string } | null;
}

export interface ApolloOrganization {
  id: string;
  name: string;
  primary_domain: string | null;
  website_url: string | null;
  industry: string | null;
  estimated_num_employees: number | null;
}

export interface EnrichResult {
  personId: string;
  name: string | null;
  email: string | null;
  title: string | null;
  linkedinUrl: string | null;
}

function buildHeaders(apiKey: string) {
  return {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

function logAxiosError(label: string, err: unknown): void {
  if (axios.isAxiosError(err)) {
    console.error(
      `${label}: ${err.response?.status} ${err.message}`,
      "body:",
      JSON.stringify(err.response?.data)
    );
  } else {
    console.error(`${label}:`, err instanceof Error ? err.message : err);
  }
}

async function withRateLimitRetry<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      console.warn(`${label}: rate limit hit, waiting 60s before retry.`);
      await new Promise((r) => setTimeout(r, 60_000));
      try {
        return await fn();
      } catch (retryErr) {
        logAxiosError(`${label} retry failed`, retryErr);
        return fallback;
      }
    }
    logAxiosError(label, err);
    return fallback;
  }
}

export async function checkApiHealth(apiKey: string): Promise<boolean> {
  try {
    const response = await axios.get(HEALTH_URL, { headers: buildHeaders(apiKey) });
    const healthy = response.status === 200;
    console.log(healthy ? "Apollo API key is valid." : "Apollo API key failed health check.");
    return healthy;
  } catch (err) {
    console.error("Apollo health check failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

// Returns obfuscated previews — no email, masked last name. Free of credits.
// Defaults to retrying on rate limit (60s wait) for batch scripts. Pass
// { retry: false } from serverless API endpoints, where rethrowing the 429
// to the caller is correct and a 60s wait would exceed function timeout.
export async function searchContacts(
  domain: string,
  apiKey: string,
  options: { retry?: boolean } = {}
): Promise<ApolloSearchResult[]> {
  const call = async () => {
    const response = await axios.post(
      SEARCH_URL,
      {
        q_organization_domains_list: [domain],
        person_titles: TARGET_TITLES,
        per_page: 10,
      },
      { headers: buildHeaders(apiKey), timeout: 15_000 }
    );
    return (response.data.people as ApolloSearchResult[]) || [];
  };
  if (options.retry === false) return call();
  return withRateLimitRetry(`Apollo search ${domain}`, call, []);
}

// Resolves a product/company name to a real organization record. Free of credits.
export async function searchOrganization(
  name: string,
  apiKey: string
): Promise<ApolloOrganization | null> {
  return withRateLimitRetry(
    `Apollo org search "${name}"`,
    async () => {
      const response = await axios.post(
        ORG_SEARCH_URL,
        { q_organization_name: name, per_page: 1 },
        { headers: buildHeaders(apiKey), timeout: 15_000 }
      );
      const orgs: ApolloOrganization[] = response.data.organizations ?? [];
      return orgs[0] ?? null;
    },
    null
  );
}

// Reveals full person record by Apollo ID. Consumes one Apollo credit per call.
export async function revealPerson(
  personId: string,
  apiKey: string
): Promise<ApolloRevealedPerson | null> {
  return withRateLimitRetry(
    `Apollo match ${personId}`,
    async () => {
      const response = await axios.post(
        MATCH_URL,
        { id: personId, reveal_personal_emails: false },
        { headers: buildHeaders(apiKey), timeout: 15_000 }
      );
      return (response.data.person as ApolloRevealedPerson) ?? null;
    },
    null
  );
}

// Workflow: search a domain for the first decision-maker, then reveal them.
// Returns personId even when reveal yields no email, so callers can persist it
// for later auto-reveal flows. Consumes at most one credit per call.
export async function enrichDomain(
  domain: string,
  apiKey: string
): Promise<EnrichResult | null> {
  const previews = await searchContacts(normalizeDomain(domain), apiKey);
  if (previews.length === 0) return null;

  const personId = previews[0].id;
  const revealed = await revealPerson(personId, apiKey);
  if (!revealed) return { personId, name: null, email: null, title: null, linkedinUrl: null };

  return {
    personId,
    name: revealed.name ?? null,
    email: revealed.email ?? null,
    title: revealed.title ?? null,
    linkedinUrl: revealed.linkedin_url ?? null,
  };
}
