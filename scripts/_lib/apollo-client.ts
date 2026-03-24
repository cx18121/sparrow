import axios from "axios";

export interface ApolloPersonResult {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  email: string | null;
  title: string;
  linkedin_url: string | null;
  organization: { name: string; primary_domain: string } | null;
}

/**
 * Checks whether the Apollo API key is valid by hitting the health endpoint.
 */
export async function checkApiHealth(apiKey: string): Promise<boolean> {
  try {
    const response = await axios.get("https://api.apollo.io/v1/auth/health", {
      headers: { "X-Api-Key": apiKey },
    });
    const healthy = response.status === 200;
    console.log(
      healthy ? "Apollo API key is valid." : "Apollo API key failed health check."
    );
    return healthy;
  } catch (err) {
    console.error("Apollo health check failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Searches for contacts at the given domain using Apollo People Search.
 * Targets technical/founder roles relevant for cold outreach.
 * Handles 429 rate limit with a 60-second retry.
 */
export async function searchContacts(
  domain: string,
  apiKey: string
): Promise<ApolloPersonResult[]> {
  const makeRequest = async (): Promise<ApolloPersonResult[]> => {
    const response = await axios.post(
      "https://api.apollo.io/v1/people/search",
      {
        q_organization_domains: [domain],
        person_titles: [
          "CTO",
          "Founder",
          "Co-Founder",
          "CEO",
          "Head of Engineering",
          "VP Engineering",
        ],
        per_page: 10,
      },
      {
        headers: {
          "X-Api-Key": apiKey,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.people || [];
  };

  try {
    return await makeRequest();
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      console.warn(
        `Apollo rate limit hit for ${domain}. Waiting 60 seconds before retry.`
      );
      await new Promise((r) => setTimeout(r, 60_000));
      try {
        return await makeRequest();
      } catch (retryErr) {
        console.error(
          `Apollo retry failed for ${domain}:`,
          retryErr instanceof Error ? retryErr.message : retryErr
        );
        return [];
      }
    }
    console.error(
      `Apollo searchContacts failed for ${domain}:`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
