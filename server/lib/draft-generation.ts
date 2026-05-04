import { prisma } from "./prisma.js";
import { generateEmailDraft } from "./ai/generate-email.js";
import {
  researchCompanyDossier,
  pickFitAngle,
  parseCachedDossier,
  type CompanyDossier,
} from "./ai/research-fit-angle.js";
import type { DraftInput } from "./ai/types.js";
import { resolveProfileForGeneration, buildSenderContextFromProfile, ProfileError } from "./sender-profile.js";
import { resolveDraftTarget } from "./draft-target.js";
import { GenerationError } from "./generation-error.js";

const DOSSIER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// In-process dedupe: when two drafts to the same company race a cache miss,
// only one Tavily+Claude call fires; the second await piggybacks on the
// first's Promise. Keyed by Company.id; entry is cleared as soon as the
// research settles. Multi-process deployments can still double-research, but
// the cache write is idempotent (last-writer-wins on identical public data).
const inFlightDossier = new Map<string, Promise<CompanyDossier>>();

interface PersonalizationInput {
  interestHook: string | null;
  companyId: string | null;
  companyInfo: {
    name: string;
    description: string | null;
    oneLiner: string | null;
    stage: string | null;
    industry: string | null;
    isHiring: boolean;
    domain: string | null;
  };
  cachedDossier: unknown | null;
  cachedDossierAt: Date | null;
  resumeText: string | null;
  apiKey: string;
}

function dossierIsFresh(at: Date | null): boolean {
  if (!at) return false;
  return Date.now() - at.getTime() < DOSSIER_TTL_MS;
}

async function researchAndCacheDossier(input: PersonalizationInput): Promise<CompanyDossier> {
  const companyId = input.companyId!; // caller checked
  const existing = inFlightDossier.get(companyId);
  if (existing) return existing;

  const envDepth = process.env.TAVILY_SEARCH_DEPTH?.trim();
  const searchDepth = envDepth === "basic" || envDepth === "advanced" ? envDepth : undefined;

  const promise = researchCompanyDossier({
    company: input.companyInfo,
    apiKey: input.apiKey,
    tavilyApiKey: process.env.TAVILY_API_KEY?.trim() || null,
    searchDepth,
  })
    .then(async dossier => {
      // Persist for the next caller. Failure to write is non-fatal —
      // we still use the dossier for this draft.
      await prisma.company
        .update({
          where: { id: companyId },
          data: { researchDossier: dossier as object, researchedAt: new Date() },
        })
        .catch(err => {
          console.warn("Failed to cache company dossier:", err);
        });
      return dossier;
    })
    .finally(() => {
      // Clear in-flight entry once the work settles so future callers re-read
      // the freshly written cache (or research again if persistence failed).
      inFlightDossier.delete(companyId);
    });

  inFlightDossier.set(companyId, promise);
  return promise;
}

async function resolvePersonalization(
  input: PersonalizationInput
): Promise<{ featureLine: string | null; fitAngle: string | null }> {
  const empty = { featureLine: null as string | null, fitAngle: null as string | null };

  // Caller-supplied interest hook wins.
  if (input.interestHook) return empty;
  // Custom contact path — no Company row to cache against.
  if (!input.companyId) return empty;

  try {
    let dossier: CompanyDossier;
    const cached = dossierIsFresh(input.cachedDossierAt)
      ? parseCachedDossier(input.cachedDossier)
      : null;
    if (cached) {
      dossier = cached;
    } else {
      dossier = await researchAndCacheDossier(input);
    }

    return await pickFitAngle({
      dossier,
      resumeText: input.resumeText,
      apiKey: input.apiKey,
    });
  } catch (err) {
    // Non-fatal: email still drafts without personalization. We log so
    // misconfiguration (e.g. invalid TAVILY_API_KEY → 401 throw) is visible
    // in production rather than silently degrading every email forever.
    console.warn("Personalization failed, drafting without feature/fit:", err);
    return empty;
  }
}

export { ProfileError };
export { GenerationError };

export interface DraftGenerationParams {
  userId: string;
  userLeadId?: string;
  customContactId?: string;
  templateId?: string | null;
  interestHook?: string | null;
  tone?: string | null;
  extraContext?: string | null;
  includeResumeBullet?: boolean;
  save?: boolean;
}

export interface DraftGenerationResult {
  subject: string;
  body: string;
  emailId: string | null;
  fallback?: true;
  error?: string;
}

// Generates a Draft for a Lead or CustomContact.
// save defaults to FALSE — callers must opt in to persisting a draft to avoid
// silent Email record creation during preview calls.
export async function generateDraft(params: DraftGenerationParams): Promise<DraftGenerationResult> {
  const { userId, templateId, interestHook, tone, extraContext, includeResumeBullet = false, save = false } = params;

  const {
    contactInfo,
    companyInfo,
    companyId,
    cachedDossier,
    cachedDossierAt,
    savedLeadId,
    savedContactId,
    savedCustomContactId,
  } = await resolveDraftTarget(params);

  // Resolve template
  let userTemplate: { subject: string; body: string } | null = null;
  if (templateId) {
    const t = await prisma.template.findUnique({ where: { id: templateId } });
    if (!t || t.userId !== userId) throw new GenerationError("Template not found. Select a different template and try again.", 404);
    userTemplate = { subject: t.subject, body: t.body };
  }

  // Resolve sender profile (throws ProfileError on missing API key or decrypt failure)
  const profile = await resolveProfileForGeneration(userId);
  const senderContext = buildSenderContextFromProfile(profile, { tone, extraContext, includeResumeBullet });

  // Two-stage personalization:
  //   1. companyDossier: cacheable per-company web research (Company.researchDossier)
  //   2. pickFitAngle: per-user, token-only — picks the surface most relevant
  //      to THIS resume so different users get different feature lines from
  //      the same shared dossier.
  // Caller-supplied interestHook short-circuits both stages. Custom contacts
  // (no companyId) skip both — there's no Company row to cache against.
  // Failures at any stage are non-fatal: the email still drafts, just without
  // the personalization lines.
  const fit = await resolvePersonalization({
    interestHook: interestHook ?? null,
    companyId,
    companyInfo,
    cachedDossier,
    cachedDossierAt,
    resumeText: profile.resumeText,
    apiKey: profile.apiKey,
  });

  const draftInput: DraftInput = userTemplate
    ? {
        kind: "template",
        body: userTemplate.body,
        contact: contactInfo,
        company: companyInfo,
        subjectTemplate: userTemplate.subject,
        senderName: profile.senderName,
        senderContext,
        apiKey: profile.apiKey,
        featureLine: fit.featureLine,
        fitAngle: fit.fitAngle,
      }
    : {
        kind: "ai",
        contact: contactInfo,
        company: companyInfo,
        subjectTemplate: null,
        senderName: profile.senderName,
        interestHook: interestHook ?? null,
        senderContext,
        apiKey: profile.apiKey,
        featureLine: fit.featureLine,
        fitAngle: fit.fitAngle,
      };

  let draft: { subject: string; body: string };
  let fallback = false;
  let generationError: string | undefined;

  try {
    draft = await generateEmailDraft(draftInput);
  } catch (err) {
    generationError = (err as Error).message;
    fallback = true;
    draft = await generateEmailDraft({
      kind: "fallback",
      contact: contactInfo,
      company: companyInfo,
      subjectTemplate: null,
      senderName: profile.senderName,
    });
  }

  let emailId: string | null = null;
  if (save) {
    const saved = await prisma.email.create({
      data: {
        ...(savedLeadId ? { userLeadId: savedLeadId } : {}),
        ...(savedContactId ? { contactId: savedContactId } : {}),
        ...(savedCustomContactId ? { customContactId: savedCustomContactId } : {}),
        subject: draft.subject,
        body: draft.body,
        status: "draft",
      },
    });
    emailId = saved.id;
  }

  return {
    subject: draft.subject,
    body: draft.body,
    emailId,
    ...(fallback && { fallback: true as const }),
    ...(generationError && { error: generationError }),
  };
}
