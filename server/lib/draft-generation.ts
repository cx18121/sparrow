import { prisma } from "./prisma.js";
import { generateEmailDraft } from "./ai/generate-email.js";
import {
  researchCompanyDossierHybrid,
  pickFitAngle,
  parseCachedDossierEnvelope,
  getDossierSlot,
  setDossierSlot,
  isEmptyDossier,
  type CompanyDossier,
  type CachedRoleSlot,
  type DossierEnvelope,
} from "./ai/research-fit-angle.js";
import type { DraftInput } from "./ai/types.js";
import type { RoleFamily } from "../../src/types/roleFamilies.js";
import { resolveProfileForGeneration, buildSenderContextFromProfile, ProfileError } from "./sender-profile.js";
import { resolveDraftTarget } from "./draft-target.js";
import { GenerationError } from "./generation-error.js";

// In-process dedupe: when two drafts to the same company race a cache miss,
// only one search+Claude call fires; the second await piggybacks on the
// first's Promise. Keyed by (Company.id, role) so two drafts to the same
// company targeting different roles each trigger their own research
// (each role has its own dossier shape per ADR-0005). Entry is cleared
// as soon as the research settles. Multi-process deployments can still
// double-research, but the cache write is idempotent — read-modify-write
// preserves other roles' slots.
const inFlightDossier = new Map<string, Promise<CompanyDossier>>();
function inFlightKey(companyId: string, role: PersonalizationInput["targetRole"]): string {
  return `${companyId}:${role ?? "_default"}`;
}

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
  // Workspace default target role family — steers pickFitAngle toward
  // function-relevant surfaces. Per-campaign override is intentionally
  // NOT applied here: a saved lead can belong to multiple campaigns over
  // time, so the workspace default is the only stable "what kind of role
  // is this candidate applying to" signal at draft-generation time. Apollo
  // discovery (which DOES know the campaign) uses the per-campaign value;
  // this stage uses the user-level default.
  targetRole: 'engineering' | 'product' | 'gtm' | 'operations' | null;
}

// A cached slot is considered fresh when it has both a slot (with its own
// per-role researchedAt timestamp from the envelope) AND non-empty content.
// Empty dossiers (zero surfaces, no recent launches, no technical areas)
// are treated as stale so the next caller re-researches. This guards
// against caching null results from a misconfigured retrieval pipeline —
// observed on 2026-05-15 when EXA_API_KEY was missing from prod: every
// researched company got a `{summary:"", surfaces:[], ...}` cache that
// then survived the env-var fix, leaving drafts permanently
// personalization-less until the cache was manually invalidated.
function dossierIsFresh(slot: CachedRoleSlot | null): boolean {
  if (!slot) return false;
  if (isEmptyDossier(slot.dossier)) return false;
  return true;
}

async function researchAndCacheDossier(
  input: PersonalizationInput,
  priorEnvelope: DossierEnvelope,
): Promise<CompanyDossier> {
  const companyId = input.companyId!; // caller checked
  const key = inFlightKey(companyId, input.targetRole);
  const existing = inFlightDossier.get(key);
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
      // Persist for the next caller. Read-modify-write the envelope so
      // concurrent research for a different role doesn't wipe this slot,
      // and so existing slots stay intact when only this role re-researches.
      // Failure to write is non-fatal — we still use the dossier for this draft.
      const now = new Date();
      const nextEnvelope = setDossierSlot(priorEnvelope, input.targetRole, {
        dossier,
        researchedAt: now,
      });
      await prisma.company
        .update({
          where: { id: companyId },
          data: { researchDossier: nextEnvelope as object, researchedAt: now },
        })
        .catch(err => {
          console.warn("Failed to cache company dossier:", err);
        });
      return dossier;
    })
    .finally(() => {
      // Clear in-flight entry once the work settles so future callers re-read
      // the freshly written cache (or research again if persistence failed).
      inFlightDossier.delete(key);
    });

  inFlightDossier.set(key, promise);
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
    // Parse the envelope once and reuse: getDossierSlot picks the role's
    // slot for the freshness check; researchAndCacheDossier needs the full
    // envelope to do its read-modify-write without wiping other slots.
    const envelope = parseCachedDossierEnvelope(input.cachedDossier, input.cachedDossierAt);
    const slot = getDossierSlot(envelope, input.targetRole);
    if (dossierIsFresh(slot)) {
      dossier = slot!.dossier;
    } else {
      dossier = await researchAndCacheDossier(input, envelope);
    }

    return await pickFitAngle({
      dossier,
      resumeText: input.resumeText,
      apiKey: input.apiKey,
      targetRole: input.targetRole,
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
  // Active campaign context. When present, the campaign's filterTargetRole
  // (if set) overrides the user's workspace default for fit-angle picking.
  // Missing → workspace default → null. Callers that know which campaign
  // the user is generating in should pass this; callers that don't (e.g.
  // standalone draft preview) get the workspace default. See the
  // resolveCampaignTargetRole call below for the resolution chain.
  campaignId?: string | null;
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

// Resolves the role-family to apply when picking a fit-angle, following the
// same override-then-default chain Apollo discovery uses: per-campaign value
// → workspace default → null. Returns null only when neither is set; the
// pickFitAngle prompt then omits the role hint and ranks surfaces by resume
// match alone.
//
// Exported so it can be unit-tested directly — the full draft-generation
// orchestrator path is heavy to mock end-to-end, and the resolution chain
// here is exactly the kind of pure logic that benefits from isolated tests.
export async function resolveCampaignTargetRole(
  campaignId: string | null | undefined,
  userId: string,
  workspaceDefault: string | null,
): Promise<string | null> {
  if (campaignId) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { userId: true, filterTargetRole: true },
    });
    // Silently ignore a campaignId that doesn't belong to this user — don't
    // leak across users, and don't throw because draft generation should
    // degrade gracefully rather than fail on stale client state.
    if (campaign && campaign.userId === userId && campaign.filterTargetRole) {
      return campaign.filterTargetRole;
    }
  }
  return workspaceDefault;
}

// Generates a Draft for a Lead or CustomContact.
// save defaults to FALSE — callers must opt in to persisting a draft to avoid
// silent Email record creation during preview calls.
export async function generateDraft(params: DraftGenerationParams): Promise<DraftGenerationResult> {
  const { userId, campaignId, templateId, interestHook, tone, extraContext, includeResumeBullet = false, save = false } = params;

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

  // Per-campaign role overrides the workspace default. Both flow through
  // normalizeRoleFamily upstream (campaign-definition for writes, on read
  // via the Campaign column being TEXT). Resolved early so it can steer
  // every downstream stage: resume-bullet preference in the sender context,
  // surface ranking in pickFitAngle, voice in the generation system prompt.
  const targetRole = await resolveCampaignTargetRole(
    campaignId ?? null,
    userId,
    profile.ws.targetRole ?? null,
  );

  const senderContext = buildSenderContextFromProfile(profile, {
    tone,
    extraContext,
    includeResumeBullet,
    targetRole: targetRole as RoleFamily | null,
  });

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
    targetRole: targetRole as PersonalizationInput["targetRole"],
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
          targetRole: targetRole as RoleFamily | null,
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
        targetRole: targetRole as RoleFamily | null,
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
