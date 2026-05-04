import { prisma } from "./prisma.js";
import { generateEmailDraft } from "./ai/generate-email.js";
import type { DraftInput } from "./ai/types.js";
import { resolveProfileForGeneration, buildSenderContextFromProfile, ProfileError } from "./sender-profile.js";
import { resolveDraftTarget } from "./draft-target.js";
import { GenerationError } from "./generation-error.js";

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
// silent Email record creation during preview calls (ContactsTab regression Mar 2026).
export async function generateDraft(params: DraftGenerationParams): Promise<DraftGenerationResult> {
  const { userId, templateId, interestHook, tone, extraContext, includeResumeBullet = false, save = false } = params;

  const {
    contactInfo,
    companyInfo,
    savedLeadId,
    savedContactId,
    savedCustomContactId,
  } = await resolveDraftTarget(params);

  // Resolve template
  let userTemplate: { subject: string; body: string } | null = null;
  if (templateId) {
    const t = await prisma.template.findUnique({ where: { id: templateId } });
    if (!t || (t.userId !== userId && !t.isShared)) throw new GenerationError("Template not found. Select a different template and try again.", 404);
    userTemplate = { subject: t.subject, body: t.body };
  }

  // Resolve sender profile (throws ProfileError on missing API key or decrypt failure)
  const profile = await resolveProfileForGeneration(userId);
  const senderContext = buildSenderContextFromProfile(profile, { tone, extraContext, includeResumeBullet });

  const draftInput: DraftInput = userTemplate
    ? {
        kind: "template",
        body: userTemplate.body,
        contact: contactInfo,
        company: companyInfo,
        subjectTemplate: userTemplate.subject,
        senderName: profile.senderName,
      }
    : {
        kind: "ai",
        contact: contactInfo,
        company: companyInfo,
        subjectTemplate: null,
        senderName: profile.senderName,
        interestHook: interestHook ?? null,
        senderContext,
        styleInstruction: profile.styleInstruction,
        exampleBodies: Array.isArray(profile.ws.styleProfile?.examples) ? profile.ws.styleProfile!.examples! : null,
        apiKey: profile.apiKey,
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
