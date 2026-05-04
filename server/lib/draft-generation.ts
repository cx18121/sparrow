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

// Pure DB lookup — no network calls, no side effects.
async function lookupRecipient(params: DraftGenerationParams) {
  const { userId, userLeadId, customContactId } = params;

  if (customContactId) {
    const cc = await prisma.customContact.findUnique({ where: { id: customContactId } });
    if (!cc || cc.userId !== userId) throw new GenerationError("Custom contact not found", 404);
    return { kind: "customContact" as const, cc, lead: null as null, contact: null as null };
  }

  const lead = await prisma.userLead.findUnique({
    where: { id: userLeadId! },
    include: { company: true, contact: true },
  });
  if (!lead || lead.userId !== userId) throw new GenerationError("Lead not found", 404);

  return { kind: "lead" as const, cc: null as null, lead, contact: lead.contact };
}

// Attempts Apollo reveal for a lead that has apolloPersonId but no Contact yet.
// Consumes one Apollo credit on success. Returns the Contact if reveal produced
// an email address; null when the key is absent, the person has no email, quota
// is exhausted, or the API call fails.
async function tryRevealContact(
  lead: { id: string; apolloPersonId: string | null; companyId: string },
  userId: string
) {
  const apolloKey = process.env.APOLLO_API_KEY;
  if (!lead.apolloPersonId || !apolloKey) return null;
  try {
    const saved = await revealAndUpsertContact(lead.apolloPersonId, lead.companyId, apolloKey, userId);
    if (saved) {
      await prisma.userLead.update({ where: { id: lead.id }, data: { contactId: saved.id } });
      return prisma.contact.findUnique({ where: { id: saved.id } });
    }
  } catch (err) {
    console.warn("Apollo reveal failed during draft generation:", err);
  }
  return null;
}

// Generates a Draft for a Lead or CustomContact.
// save defaults to FALSE — callers must opt in to persisting a draft to avoid
// silent Email record creation during preview calls (ContactsTab regression Mar 2026).
export async function generateDraft(params: DraftGenerationParams): Promise<DraftGenerationResult> {
  const { userId, templateId, interestHook, tone, extraContext, includeResumeBullet = false, save = false } = params;

  const lookup = await lookupRecipient(params);

  let contactInfo: { name: string | null; title: string | null };
  let companyInfo: { name: string; description: string | null; oneLiner: string | null; stage: string | null; industry: string | null; isHiring: boolean };
  let savedLeadId: string | null;
  let savedContactId: string | null;
  let savedCustomContactId: string | null;

  if (lookup.kind === "customContact") {
    const { cc } = lookup;
    contactInfo = { name: cc.name, title: cc.title };
    companyInfo = { name: cc.companyName ?? "", description: null, oneLiner: null, stage: null, industry: null, isHiring: false };
    savedLeadId = null;
    savedContactId = null;
    savedCustomContactId = cc.id;
  } else {
    const { lead } = lookup;
    let contact = lookup.contact;

    if (!contact) {
      contact = await tryRevealContact(lead, userId);
    }

    if (!contact) {
      throw new GenerationError(
        lead.apolloPersonId
          ? "Could not fetch contact details for this lead. Try enriching it again from Discover."
          : "Lead has no contact. Save a lead from Discover to get contact details.",
        400
      );
    }

    contactInfo = { name: contact.name, title: contact.title };
    companyInfo = {
      name: lead.company.name, description: lead.company.description,
      oneLiner: lead.company.oneLiner, stage: lead.company.stage,
      industry: lead.company.industry, isHiring: lead.company.isHiring,
    };
    savedLeadId = lead.id;
    savedContactId = contact.id;
    savedCustomContactId = null;
  }

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
