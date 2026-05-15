import { prisma } from "./prisma.js";
import { generateEmailDraft } from "./ai/generate-email.js";
import {
  researchCompanyDossierHybrid,
  pickFitAngle,
  parseCachedDossier,
  isEmptyDossier,
  type CompanyDossier,
} from "./ai/research-fit-angle.js";
import type { DraftInput } from "./ai/types.js";
import { resolveProfileForGeneration, buildSenderContextFromProfile, ProfileError } from "./sender-profile.js";
import { resolveDraftTarget } from "./draft-target.js";
import { GenerationError } from "./generation-error.js";

// In-process dedupe: when two drafts to the same company race a cache miss,
// only one search+Claude call fires; the second await piggybacks on the
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

// A cached dossier is considered fresh when it has both a timestamp AND
// non-empty content. Empty dossiers (zero surfaces, no recent launches,
// no technical areas) are treated as stale so the next caller re-researches.
// This guards against caching null results from a misconfigured retrieval
// pipeline — observed on 2026-05-15 when EXA_API_KEY was missing from prod:
// every researched company got a `{summary:"", surfaces:[], ...}` cache
// that then survived the env-var fix, leaving drafts permanently
// personalization-less until the cache was manually invalidated.
function dossierIsFresh(at: Date | null, dossier: CompanyDossier | null): boolean {
  if (at === null) return false;
  if (!dossier) return false;
  if (isEmptyDossier(dossier)) return false;
  return true;
}

async function researchAndCacheDossier(input: PersonalizationInput): Promise<CompanyDossier> {
  const companyId = input.companyId!; // caller checked
  const existing = inFlightDossier.get(companyId);
  if (existing) return existing;

  const envDepth = process.env.TAVILY_SEARCH_DEPTH?.trim();
  const tavilySearchDepth = envDepth === "basic" || envDepth === "advanced" ? envDepth : undefined;
  const envRecency = parseInt(process.env.EXA_RECENCY_DAYS?.trim() ?? "", 10);
  const recencyDays = Number.isFinite(envRecency) && envRecency > 0 ? envRecency : undefined;

  // Hybrid: layered Exa /search + /contents merged (anchor truth from the
  // company's own pages plus third-party news for recency), Tavily as final
  // fallback only when both Exa calls return 0 results. Either key alone is
  // fine; missing both gracefully degrades to an empty dossier and the email
  // drafts without personalization.
  const promise = researchCompanyDossierHybrid({
    company: input.companyInfo,
    apiKey: input.apiKey,
    exaApiKey: process.env.EXA_API_KEY?.trim() || null,
    tavilyApiKey: process.env.TAVILY_API_KEY?.trim() || null,
    recencyDays,
    tavilySearchDepth,
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
    const parsedCache = parseCachedDossier(input.cachedDossier);
    const cached = dossierIsFresh(input.cachedDossierAt, parsedCache) ? parsedCache : null;
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
  attachmentIds?: string[];
  interestHook?: string | null;
  tone?: string | null;
  extraContext?: string | null;
  includeResumeBullet?: boolean;
  save?: boolean;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
}

function defaultResumeAttachmentIds(ws: { resumePath?: string | null; resumeFileName?: string | null }): string[] {
  return ws.resumePath && ws.resumeFileName ? ["resume"] : [];
}

type ExistingDraft = { id: string; subject: string | null; body: string | null };

function draftLookupWhere(savedLeadId: string | null, savedCustomContactId: string | null) {
  if (savedLeadId) return { userLeadId: savedLeadId, status: "draft" };
  if (savedCustomContactId) return { customContactId: savedCustomContactId, status: "draft" };
  return null;
}

function draftLockKey(savedLeadId: string | null, savedCustomContactId: string | null) {
  if (savedLeadId) return `draft:userLead:${savedLeadId}`;
  if (savedCustomContactId) return `draft:customContact:${savedCustomContactId}`;
  return null;
}

async function findExistingDraft(client: any, savedLeadId: string | null, savedCustomContactId: string | null): Promise<ExistingDraft | null> {
  const where = draftLookupWhere(savedLeadId, savedCustomContactId);
  if (!where) return null;
  return client.email.findFirst({
    where,
    orderBy: { createdAt: "desc" },
    select: { id: true, subject: true, body: true },
  });
}

async function saveDraftOnce(params: {
  savedLeadId: string | null;
  savedContactId: string | null;
  savedCustomContactId: string | null;
  subject: string;
  body: string;
  attachmentIds: string[];
  featureLine: string | null;
  fitAngle: string | null;
  generationKind: "verbatim" | "template" | "ai" | "fallback";
}): Promise<ExistingDraft> {
  const lockKey = draftLockKey(params.savedLeadId, params.savedCustomContactId);
  if (!lockKey) {
    return prisma.email.create({
      data: {
        ...(params.savedContactId ? { contactId: params.savedContactId } : {}),
        subject: params.subject,
        body: params.body,
        status: "draft",
        attachmentIds: params.attachmentIds,
        featureLine: params.featureLine,
        fitAngle: params.fitAngle,
        generationKind: params.generationKind,
      },
      select: { id: true, subject: true, body: true },
    });
  }

  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const existing = await findExistingDraft(tx, params.savedLeadId, params.savedCustomContactId);
    if (existing) return existing;
    return tx.email.create({
      data: {
        ...(params.savedLeadId ? { userLeadId: params.savedLeadId } : {}),
        ...(params.savedContactId ? { contactId: params.savedContactId } : {}),
        ...(params.savedCustomContactId ? { customContactId: params.savedCustomContactId } : {}),
        subject: params.subject,
        body: params.body,
        status: "draft",
        attachmentIds: params.attachmentIds,
        featureLine: params.featureLine,
        fitAngle: params.fitAngle,
        generationKind: params.generationKind,
      },
      select: { id: true, subject: true, body: true },
    });
  });
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

  if (save) {
    const existing = await findExistingDraft(prisma, savedLeadId, savedCustomContactId);
    if (existing) {
      return {
        subject: existing.subject ?? "",
        body: existing.body ?? "",
        emailId: existing.id,
      };
    }
  }

  // Resolve template
  let userTemplate: { subject: string; body: string; verbatim: boolean; attachmentIds: string[] } | null = null;
  if (templateId) {
    const t = await prisma.template.findUnique({ where: { id: templateId } });
    if (!t || t.userId !== userId) throw new GenerationError("Template not found. Select a different template and try again.", 404);
    userTemplate = { subject: t.subject, body: t.body, verbatim: t.verbatim, attachmentIds: stringArray(t.attachmentIds) };
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
    ? userTemplate.verbatim
      ? {
          kind: "verbatim",
          body: userTemplate.body,
          contact: contactInfo,
          company: companyInfo,
          subjectTemplate: userTemplate.subject,
          senderName: profile.senderName,
          featureLine: fit.featureLine,
          fitAngle: fit.fitAngle,
        }
      : {
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
    const explicitAttachmentIds = params.attachmentIds !== undefined ? stringArray(params.attachmentIds) : null;
    const attachmentIds = explicitAttachmentIds ?? userTemplate?.attachmentIds ?? defaultResumeAttachmentIds(profile.ws);
    const saved = await saveDraftOnce({
      savedLeadId,
      savedContactId,
      savedCustomContactId,
      subject: draft.subject,
      body: draft.body,
      attachmentIds,
      // Capture what was actually fed into the draft. fit values reflect what
      // pickFitAngle returned (or null on NONE / disabled). generationKind
      // reflects the path that ran — fallback wins if the primary path threw.
      featureLine: fit.featureLine,
      fitAngle: fit.fitAngle,
      generationKind: fallback ? "fallback" : draftInput.kind,
    });
    emailId = saved.id;
    draft = {
      subject: saved.subject ?? draft.subject,
      body: saved.body ?? draft.body,
    };
  }

  return {
    subject: draft.subject,
    body: draft.body,
    emailId,
    ...(fallback && { fallback: true as const }),
    ...(generationError && { error: generationError }),
  };
}
