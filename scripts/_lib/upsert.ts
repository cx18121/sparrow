import type { Company, Contact } from "@prisma/client";
import { prisma } from "./prisma.js";
import { normalizeRegion } from "./region-map.js";
import { normalizeRole } from "./role-normalizer.js";

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
 * Calls normalizeRegion on the location field.
 */
export async function upsertCompany(data: CompanyInput): Promise<Company> {
  const region = normalizeRegion(data.location ?? null);

  const sharedData = {
    name: data.name,
    description: data.description ?? null,
    oneLiner: data.oneLiner ?? null,
    website: data.website ?? null,
    stage: data.stage ?? null,
    industry: data.industry ?? null,
    subIndustry: data.subIndustry ?? null,
    location: data.location ?? null,
    region,
    headcount: data.headcount ?? null,
    isHiring: data.isHiring ?? false,
    batch: data.batch ?? null,
    lastScrapedAt: new Date(),
  };

  return prisma.company.upsert({
    where: { domain: data.domain },
    update: sharedData,
    create: {
      ...sharedData,
      domain: data.domain,
      source: data.source,
      sourceId: data.sourceId ?? null,
    },
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
    update: sharedData,
    create: {
      ...sharedData,
      companyId: data.companyId,
      email: data.email,
      source: data.source,
    },
  });
}
