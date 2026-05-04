import { prisma } from "./prisma.js";
import { generateEmailDraft } from "./ai/generate-email.js";
import type { DraftInput } from "./ai/types.js";
import { resolveProfileForGeneration, buildSenderContextFromProfile, ProfileError } from "./sender-profile.js";
import { revealAndUpsertContact } from "./apollo-enrichment.js";

export { ProfileError };

export class GenerationError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 500) {
    super(message);
  }
}

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

// Resolves the email recipient from either a UserLead or a CustomContact.
// For UserLeads, attempts Apollo auto-reveal if the lead has no Contact yet.
// Throws GenerationError when the lead is not found or has no usable contact.
async function resolveRecipient(params: DraftGenerationParams) {
  const { userId, userLeadId, customContactId } = params;

  if (customContactId) {
    const cc = await prisma.customContact.findUnique({ where: { id: customContactId } });
    if (!cc || cc.userId !== userId) throw new GenerationError("Custom contact not found", 404);
    return {
      contactInfo: { name: cc.name, title: cc.title },
      companyInfo: { name: cc.companyName ?? "", description: null, oneLiner: null, stage: null, industry: null, isHiring: false },
      savedLeadId: null as string | null,
      savedContactId: null as string | null,
      savedCustomContactId: cc.id,
    };
  }

  const lead = await prisma.userLead.findUnique({
    where: { id: userLeadId! },
    include: { company: true, contact: true },
  });
  if (!lead || lead.userId !== userId) throw new GenerationError("Lead not found", 404);

  let contact = lead.contact;
  if (!contact && lead.apolloPersonId) {
    const apolloKey = process.env.APOLLO_API_KEY;
    if (apolloKey) {
      try {
        const saved = await revealAndUpsertContact(lead.apolloPersonId, lead.companyId, apolloKey);
        if (saved) {
          await prisma.userLead.update({ where: { id: lead.id }, data: { contactId: saved.id } });
          contact = await prisma.contact.findUnique({ where: { id: saved.id } });
        }
      } catch (err) {
        console.warn("Apollo reveal failed, proceeding without contact:", err);
      }
    }
  }
  if (!contact) {
    throw new GenerationError("Lead has no contact. Save a lead from Discover to get contact details.", 400);
  }

  return {
    contactInfo: { name: contact.name, title: contact.title },
    companyInfo: {
      name: lead.company.name, description: lead.company.description,
      oneLiner: lead.company.oneLiner, stage: lead.company.stage,
      industry: lead.company.industry, isHiring: lead.company.isHiring,
    },
    savedLeadId: lead.id,
    savedContactId: contact.id,
    savedCustomContactId: null as string | null,
  };
}

// Generates a Draft for a Lead or CustomContact.
// Handles: recipient resolution (with optional Apollo auto-reveal), template lookup,
// profile fetch, AI generation with fallback, and optional draft persistence.
export async function generateDraft(params: DraftGenerationParams): Promise<DraftGenerationResult> {
  // save defaults to FALSE — callers must opt in to persisting a draft.
  // This avoids the trap where a "preview" call silently creates an Email record
  // that the user never saw or approved (see ContactsTab regression Mar 2026).
  const { userId, templateId, interestHook, tone, extraContext, includeResumeBullet = false, save = false } = params;

  const { contactInfo, companyInfo, savedLeadId, savedContactId, savedCustomContactId } =
    await resolveRecipient(params);

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
