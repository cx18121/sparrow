import type { Company, Contact } from "@prisma/client";
import { prisma } from "./prisma.js";
import { normalizeRegion } from "./region-map.js";
import { normalizeRole } from "./role-normalizer.js";
import { reconcileCompany } from "./reconcile-company.js";

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

function normalizeDomain(raw: string): string {
  return raw.toLowerCase().replace(/^www\./i, "");
}

// Idempotent upsert for a Company record by domain. Reconciliation rules
// (tags, isVerified, qualityScore, name overwrite) live in reconcileCompany;
// this function owns the SQL and the sparse-update field policy.
//
// On UPDATE: only writes fields the source actually observed (data[k] != null).
// Sparse sources cannot erase authoritative fields populated by richer ones.
export async function upsertCompany(input: CompanyInput): Promise<Company> {
  const data = { ...input, domain: normalizeDomain(input.domain) };

  const existing = await prisma.company.findUnique({
    where: { domain: data.domain },
    select: { id: true, tags: true, isVerified: true, qualityScore: true, source: true },
  });

  const reconciled = reconcileCompany(
    existing
      ? {
          source: existing.source,
          tags: existing.tags,
          isVerified: existing.isVerified,
          qualityScore: existing.qualityScore,
        }
      : null,
    {
      source: data.source,
      tags: data.tags ?? [],
      isVerified: data.isVerified ?? false,
      qualityScore: data.qualityScore ?? null,
    }
  );

  const update: Record<string, unknown> = {
    tags: reconciled.tags,
    isVerified: reconciled.isVerified,
    qualityScore: reconciled.qualityScore,
    lastScrapedAt: new Date(),
  };
  if (reconciled.shouldOverwriteName) update.name = data.name;
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
    tags: reconciled.tags,
    isVerified: reconciled.isVerified,
    qualityScore: reconciled.qualityScore,
    lastScrapedAt: new Date(),
  };

  return prisma.company.upsert({
    where: { domain: data.domain },
    update,
    create,
  });
}

// Idempotent upsert for a Contact record by email. Returns null if email is
// falsy — contacts without email cannot be used for outreach.
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
