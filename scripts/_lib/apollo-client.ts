import axios from "axios";

const SEARCH_URL = "https://api.apollo.io/api/v1/mixed_people/api_search";
const MATCH_URL = "https://api.apollo.io/api/v1/people/match";
const HEALTH_URL = "https://api.apollo.io/v1/auth/health";

const TARGET_TITLES = [
  "CTO",
  "Founder",
  "Co-Founder",
  "CEO",
  "Head of Engineering",
  "VP Engineering",
];

function buildHeaders(apiKey: string) {
  return {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

/**
 * Apollo's mixed_people/api_search returns obfuscated previews — last name is masked,
 * email and linkedin_url are not included. Use revealPerson(id) to fetch full data.
 */
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

/**
 * Searches Apollo for people at the given domain matching TARGET_TITLES.
 * Returns obfuscated previews — call revealPerson(id) to get email and full name.
 * This call does NOT consume reveal credits.
 */
export async function searchContacts(
  domain: string,
  apiKey: string
): Promise<ApolloSearchResult[]> {
  return withRateLimitRetry(
    `Apollo search ${domain}`,
    async () => {
      const response = await axios.post(
        SEARCH_URL,
        {
          q_organization_domains_list: [domain],
          person_titles: TARGET_TITLES,
          per_page: 10,
        },
        { headers: buildHeaders(apiKey) }
      );
      return (response.data.people as ApolloSearchResult[]) || [];
    },
    []
  );
}

export interface ApolloOrganization {
  id: string;
  name: string;
  primary_domain: string | null;
  website_url: string | null;
  industry: string | null;
  estimated_num_employees: number | null;
}

/**
 * Searches Apollo for an organization by name and returns the best match.
 * Used to resolve a product name (e.g. from Product Hunt) to a real domain.
 * This call does NOT consume reveal credits.
 */
export async function searchOrganization(
  name: string,
  apiKey: string
): Promise<ApolloOrganization | null> {
  return withRateLimitRetry(
    `Apollo org search "${name}"`,
    async () => {
      const response = await axios.post(
        "https://api.apollo.io/api/v1/mixed_companies/search",
        { q_organization_name: name, per_page: 1 },
        { headers: buildHeaders(apiKey), timeout: 15_000 }
      );
      const orgs: ApolloOrganization[] = response.data.organizations ?? [];
      return orgs[0] ?? null;
    },
    null
  );
}

/**
 * Reveals a person's full record (including email) by Apollo person id.
 * This call CONSUMES one Apollo reveal credit per successful invocation.
 */
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
        { headers: buildHeaders(apiKey) }
      );
      return (response.data.person as ApolloRevealedPerson) ?? null;
    },
    null
  );
}
