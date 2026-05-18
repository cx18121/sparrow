import { prisma, type Db } from "./prisma.js";
import { revealPerson, enrichDomain } from "./apollo.js";
import { consumeDurableDailyQuota } from "./rate-limit.js";
import type { RoleFamily } from "../../src/types/roleFamilies.js";

// Workflow helpers that combine Apollo HTTP primitives with DB writes.
// Pure HTTP lives in ./apollo.ts; this file is the only place that turns an
// Apollo reveal into a persisted Contact row.
//
// Quota enforcement is inside this module — callers of the credit-spending
// functions cannot bypass it. apollo-search.ts calls revealPerson directly and
// manages its own quota for the UI-preview (non-persisting) path.

export interface SavedContact {
  id: string;
  name: string | null;
  email: string | null;
  title: string | null;
}

// The raw reveal data returned by Apollo before any DB write.
// Returned by fetchEnrichedDomain so callers can run the DB write
// separately — e.g. inside a transaction — from the HTTP phase.
export interface EnrichedPerson {
  name: string | null;
  email: string | null;
  title: string | null;
  linkedinUrl: string | null;
  personId: string | null;
}

interface RevealShape {
  name: string | null;
  email: string | null;
  title: string | null;
  linkedinUrl: string | null;
}

function revealDailyLimit(): number {
  return Number(process.env.APOLLO_REVEAL_DAILY_LIMIT ?? 50);
}

async function enforceRevealQuota(userId: string, db: Db): Promise<void> {
  await consumeDurableDailyQuota("apollo", userId, "reveal", revealDailyLimit(), db);
}

// Persists a revealed person as a Contact row. Returns null when the reveal
// produced no email (Contact.email is the unique key). Caller is responsible
// for whatever HTTP/credit cost produced the reveal.
export async function upsertContactFromReveal(
  reveal: RevealShape,
  companyId: string,
  db: Db = prisma
): Promise<SavedContact | null> {
  if (!reveal.email) return null;

  const saved = await db.contact.upsert({
    where: { email: reveal.email },
    create: {
      companyId,
      name: reveal.name,
      email: reveal.email,
      title: reveal.title,
      role: null,
      linkedinUrl: reveal.linkedinUrl,
      source: "apollo",
    },
    update: {
      name: reveal.name ?? undefined,
      title: reveal.title ?? undefined,
      linkedinUrl: reveal.linkedinUrl ?? undefined,
      lastVerifiedAt: new Date(),
    },
  });

  return { id: saved.id, name: saved.name, email: saved.email, title: saved.title };
}

// Pure HTTP — no DB write, no quota charge. Returns the raw enrichment data so
// callers can run the DB write separately (e.g. inside a transaction), decoupling
// the Apollo HTTP latency from any held DB lock.
// roleFamilies threads through to enrichDomain → searchContacts; see those.
export async function fetchEnrichedDomain(
  domain: string,
  apiKey: string,
  options: { roleFamilies?: RoleFamily[] } = {}
): Promise<EnrichedPerson | null> {
  return enrichDomain(domain, apiKey, options);
}

// Quota-enforced: searches a company domain for a decision-maker, reveals them,
// and persists the Contact. Quota check, HTTP call, and DB write all happen here —
// callers cannot bypass any step. Consumes at most one Apollo credit.
// Pass a transaction client as `db` to run the quota + upsert atomically with the caller's txn.
export async function enrichContactFromDomain(
  domain: string,
  companyId: string,
  apiKey: string,
  userId: string,
  db: Db = prisma,
  options: { roleFamilies?: RoleFamily[] } = {}
): Promise<{ contact: SavedContact | null; apolloPersonId: string | null }> {
  await enforceRevealQuota(userId, db);
  const enriched = await enrichDomain(domain, apiKey, options);
  if (!enriched) return { contact: null, apolloPersonId: null };
  const contact = await upsertContactFromReveal(enriched, companyId, db);
  return { contact, apolloPersonId: enriched.personId };
}

// Quota-enforced: reveals an Apollo person ID and upserts the resulting Contact.
// Consumes one Apollo credit. Returns null when reveal failed or produced no email.
export async function revealAndUpsertContact(
  personId: string,
  companyId: string,
  apiKey: string,
  userId: string
): Promise<SavedContact | null> {
  await enforceRevealQuota(userId, prisma);
  const revealed = await revealPerson(personId, apiKey);
  if (!revealed) return null;
  return upsertContactFromReveal(
    {
      name: revealed.name ?? null,
      email: revealed.email ?? null,
      title: revealed.title ?? null,
      linkedinUrl: revealed.linkedin_url ?? null,
    },
    companyId
  );
}
