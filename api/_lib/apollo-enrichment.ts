import axios from "axios";
import { prisma } from "./prisma.js";

const SEARCH_URL = "https://api.apollo.io/api/v1/mixed_people/api_search";
const MATCH_URL = "https://api.apollo.io/api/v1/people/match";
const TARGET_TITLES = ["CEO", "CTO", "Founder", "Co-Founder", "Head of Engineering", "VP Engineering"];

function headers(apiKey: string) {
  return { "x-api-key": apiKey, "Content-Type": "application/json", accept: "application/json" };
}

export interface RevealedPerson {
  name: string | null;
  email: string | null;
  title: string | null;
  linkedinUrl: string | null;
}

export interface EnrichResult extends RevealedPerson {
  personId: string;
}

// Reveals full contact details for a known Apollo person ID.
export async function revealContact(personId: string, apiKey: string): Promise<RevealedPerson | null> {
  try {
    const { data } = await axios.post(
      MATCH_URL,
      { id: personId, reveal_personal_emails: false },
      { headers: headers(apiKey), timeout: 15_000 }
    );
    const p = data.person;
    if (!p) return null;
    return { name: p.name ?? null, email: p.email ?? null, title: p.title ?? null, linkedinUrl: p.linkedin_url ?? null };
  } catch {
    return null;
  }
}

// Searches Apollo for a decision-maker at a domain, then reveals their full contact.
export async function enrichDomain(domain: string, apiKey: string): Promise<EnrichResult | null> {
  try {
    const searchRes = await axios.post(
      SEARCH_URL,
      { q_organization_domains_list: [domain], person_titles: TARGET_TITLES, per_page: 1 },
      { headers: headers(apiKey), timeout: 15_000 }
    );
    const people: Array<{ id: string }> = searchRes.data.people ?? [];
    if (people.length === 0) return null;

    const personId = people[0].id;
    const revealed = await revealContact(personId, apiKey);
    if (!revealed) return null;
    return { personId, ...revealed };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      console.warn(`Apollo rate limit hit for domain: ${domain}`);
    } else if (axios.isAxiosError(err)) {
      console.warn(`Apollo enrichment failed for ${domain}: ${err.response?.status} ${err.message}`);
    }
    return null;
  }
}

// Reveals an Apollo person ID and upserts the resulting Contact record.
// Returns the saved Contact, or null if reveal failed or produced no email.
export async function revealAndUpsertContact(
  personId: string,
  companyId: string,
  apiKey: string
): Promise<{ id: string; name: string | null; email: string | null; title: string | null } | null> {
  const revealed = await revealContact(personId, apiKey);
  if (!revealed?.email) return null;

  const saved = await prisma.contact.upsert({
    where: { email: revealed.email },
    create: {
      companyId,
      name: revealed.name,
      email: revealed.email,
      title: revealed.title,
      role: null,
      linkedinUrl: revealed.linkedinUrl,
      source: "apollo",
    },
    update: {
      name: revealed.name ?? undefined,
      title: revealed.title ?? undefined,
      linkedinUrl: revealed.linkedinUrl ?? undefined,
      lastVerifiedAt: new Date(),
    },
  });

  return { id: saved.id, name: saved.name, email: saved.email, title: saved.title };
}
