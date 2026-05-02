import { prisma } from "./prisma.js";
import { revealPerson, enrichDomain } from "./apollo.js";

// Workflow helpers that combine Apollo HTTP primitives with DB writes.
// Pure HTTP lives in ./apollo.ts; this file is the only place that turns an
// Apollo reveal into a persisted Contact row.

export interface SavedContact {
  id: string;
  name: string | null;
  email: string | null;
  title: string | null;
}

interface RevealShape {
  name: string | null;
  email: string | null;
  title: string | null;
  linkedinUrl: string | null;
}

// Persists a revealed person as a Contact row. Returns null when the reveal
// produced no email (Contact.email is the unique key). Caller is responsible
// for whatever HTTP/credit cost produced the reveal.
export async function upsertContactFromReveal(
  reveal: RevealShape,
  companyId: string
): Promise<SavedContact | null> {
  if (!reveal.email) return null;

  const saved = await prisma.contact.upsert({
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

// Searches a company domain for a decision-maker, reveals them, and persists
// the Contact. Returns the saved contact (if email found) and the personId
// (always, when a person was found) so callers can store it for later auto-reveal.
// Consumes at most one Apollo credit.
export async function enrichContactFromDomain(
  domain: string,
  companyId: string,
  apiKey: string
): Promise<{ contact: SavedContact | null; apolloPersonId: string | null }> {
  const enriched = await enrichDomain(domain, apiKey);
  if (!enriched) return { contact: null, apolloPersonId: null };
  const contact = await upsertContactFromReveal(enriched, companyId);
  return { contact, apolloPersonId: enriched.personId };
}

// Reveals an Apollo person ID and upserts the resulting Contact record.
// Consumes one Apollo credit. Returns null when the reveal failed or the
// revealed record had no email.
export async function revealAndUpsertContact(
  personId: string,
  companyId: string,
  apiKey: string
): Promise<SavedContact | null> {
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
