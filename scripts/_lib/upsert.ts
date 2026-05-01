import type { Company, Contact } from "@prisma/client";
import { prisma } from "./prisma.js";
import { normalizeRegion } from "./region-map.js";
import { normalizeRole } from "./role-normalizer.js";
import { mergeTags } from "./tags.js";

const SOURCE_PRIORITY: Record<string, number> = {
  yc: 3, workatastartup: 3,
  accel: 2, kleinerperkins: 2, firstround: 2, initialized: 2, thehub: 2,
  gregslist: 1, startups_gallery: 1, hn_hiring: 1,
};

export interface CompanyInput {
  domain: string;
  name: string;
  description?: string | null;
  oneLiner?: string | null;
  website?: string | null;
  stage?: string | null;
  industry?: string | null;
  subIndustry?: string | null;
  location?: string | null;
  headcount?: number | null;
  isHiring?: boolean;
  batch?: string | null;
  source: string;
  sourceId?: string | null;
  tags?: string[];
  isVerified?: boolean;
  qualityScore?: number | null;
}

export interface ContactInput {
  companyId: string;
  email: string;
  name?: string | null;
  title?: string | null;
  linkedinUrl?: string | null;
  source: string;
}

/**
 * Idempotent upsert for a Company record.
 * Uses domain as the unique conflict key.
 *
 * On CREATE: nulls/false defaults for omitted fields.
 *
 * On UPDATE: only writes fields that the source actually observed (data[k] != null).
 * This prevents sparse sources (Gregslist, Gallery) from erasing authoritative
 * fields (stage, batch, headcount, etc.) populated by YC when they
 * happen to encounter the same domain.
 *
 * Special-case merges on UPDATE:
 * - tags: union — appearance in a new source adds tags, never drops them.
 * - isVerified: one-way ratchet — once true, stays true.
 * - qualityScore: max of old and new — best signal wins.
 * - name: always overwritten (required field; rebrands should propagate).
 * - lastScrapedAt: always set to now (signals "we saw this row again").
 */
function normalizeDomain(raw: string): string {
  return raw.toLowerCase().replace(/^www\./i, "");
}

export async function upsertCompany(input: CompanyInput): Promise<Company> {
  const data = { ...input, domain: normalizeDomain(input.domain) };
  const newTags = data.tags ?? [];
  const newVerified = data.isVerified;
  const newScore = data.qualityScore ?? null;

  const existing = await prisma.company.findUnique({
    where: { domain: data.domain },
    select: { id: true, tags: true, isVerified: true, qualityScore: true, source: true },
  });

  const mergedTags = mergeTags(existing?.tags, newTags);
  if (existing && existing.source !== data.source) {
    if (!mergedTags.includes("signal:multi-source")) {
      mergedTags.push("signal:multi-source");
    }
  }

  const isVerified = (existing?.isVerified ?? false) || (newVerified ?? false);
  const existingScore = existing?.qualityScore ?? null;
  const baseScore =
    existingScore !== null && newScore !== null
      ? Math.max(existingScore, newScore)
      : existingScore ?? newScore;
  const isNewMultiSource = !!(existing && existing.source !== data.source && !existing.tags?.includes("signal:multi-source"));
  const qualityScore = isNewMultiSource ? Math.min((baseScore ?? 0) + 10, 100) : baseScore;

  const incomingPriority = SOURCE_PRIORITY[data.source] ?? 1;
  const existingPriority = SOURCE_PRIORITY[existing?.source ?? ""] ?? 1;

  // UPDATE payload — sparse on purpose. Only fields the source observed get written.
  const update: Record<string, unknown> = {
    tags: mergedTags,
    isVerified,
    qualityScore,
    lastScrapedAt: new Date(),
  };
  if (incomingPriority >= existingPriority) update.name = data.name;
  if (data.description != null) update.description = data.description;
  if (data.oneLiner != null) update.oneLiner = data.oneLiner;
  if (data.website != null) update.website = data.website;
  if (data.stage != null) update.stage = data.stage;
  if (data.industry != null) update.industry = data.industry;
  if (data.subIndustry != null) update.subIndustry = data.subIndustry;
  if (data.location != null) {
    update.location = data.location;
    update.region = normalizeRegion(data.location);
  }
  if (data.headcount != null) update.headcount = data.headcount;
  if (data.isHiring != null) update.isHiring = data.isHiring;
  if (data.batch != null) update.batch = data.batch;

  // CREATE payload — full record with explicit null/false defaults.
  const create = {
    domain: data.domain,
    name: data.name,
    description: data.description ?? null,
    oneLiner: data.oneLiner ?? null,
    website: data.website ?? null,
    stage: data.stage ?? null,
    industry: data.industry ?? null,
    subIndustry: data.subIndustry ?? null,
    location: data.location ?? null,
    region: data.location != null ? normalizeRegion(data.location) : null,
    headcount: data.headcount ?? null,
    isHiring: data.isHiring ?? false,
    batch: data.batch ?? null,
    source: data.source,
    sourceId: data.sourceId ?? null,
    tags: mergedTags,
    isVerified: newVerified ?? false,
    qualityScore: newScore,
    lastScrapedAt: new Date(),
  };

  return prisma.company.upsert({
    where: { domain: data.domain },
    update,
    create,
  });
}

/**
 * Idempotent upsert for a Contact record.
 * Uses email as the unique conflict key.
 * Returns null if email is falsy — contacts without email cannot be used for outreach.
 * Calls normalizeRole on the title field.
 */
export async function upsertContact(
  data: ContactInput
): Promise<Contact | null> {
  if (!data.email) return null;

  const role = normalizeRole(data.title ?? null);

  const sharedData = {
    name: data.name ?? null,
    title: data.title ?? null,
    role,
    linkedinUrl: data.linkedinUrl ?? null,
    lastVerifiedAt: new Date(),
  };

  return prisma.contact.upsert({
    where: { email: data.email },
    create: {
      ...sharedData,
      companyId: data.companyId,
      email: data.email,
      source: data.source,
    },
    update: sharedData,
  });
}
