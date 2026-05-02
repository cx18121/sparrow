import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../_lib/prisma.js";
import { getUserIdFromRequest } from "../_lib/supabaseAdmin.js";
import { generateEmailDraft } from "../_lib/ai/generate-email.js";
import type { DraftInput } from "../_lib/ai/types.js";
import { resolveProfileForGeneration, buildSenderContextFromProfile, ProfileError } from "../_lib/sender-profile.js";
import { revealAndUpsertContact } from "../_lib/apollo-enrichment.js";

type GenerateBody = {
  userLeadId?: string;
  customContactId?: string;
  templateId?: string;
  interestHook?: string;
  tone?: string;
  extraContext?: string;
  includeResumeBullet?: boolean;
  save?: boolean; // default true — pass false to preview without persisting
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = parseBody(req) as GenerateBody;
  const { userLeadId, customContactId, templateId, interestHook, tone, extraContext, includeResumeBullet = false, save = true } = body;

  if (!userLeadId && !customContactId) {
    return res.status(400).json({ error: "userLeadId or customContactId is required" });
  }

  // -- Resolve contact and company info --
  let contactInfo: { name: string | null; title: string | null } = { name: null, title: null };
  let companyInfo: {
    name: string; description: string | null; oneLiner: string | null;
    stage: string | null; industry: string | null; isHiring: boolean;
  } = { name: "", description: null, oneLiner: null, stage: null, industry: null, isHiring: false };
  let savedLeadId: string | null = null;
  let savedContactId: string | null = null;
  let savedCustomContactId: string | null = null;

  if (customContactId) {
    const cc = await prisma.customContact.findUnique({ where: { id: customContactId } });
    if (!cc || cc.userId !== userId) return res.status(404).json({ error: "Custom contact not found" });
    contactInfo = { name: cc.name, title: cc.title };
    companyInfo.name = cc.companyName ?? "";
    savedCustomContactId = cc.id;
  } else {
    const lead = await prisma.userLead.findUnique({
      where: { id: userLeadId! },
      include: { company: true, contact: true },
    });
    if (!lead || lead.userId !== userId) return res.status(404).json({ error: "Lead not found" });

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
      return res.status(400).json({ error: "Lead has no contact. Save a lead from Discover to get contact details." });
    }

    contactInfo = { name: contact.name, title: contact.title };
    companyInfo = {
      name: lead.company.name, description: lead.company.description,
      oneLiner: lead.company.oneLiner, stage: lead.company.stage,
      industry: lead.company.industry, isHiring: lead.company.isHiring,
    };
    savedLeadId = lead.id;
    savedContactId = contact.id;
  }

  // -- Resolve template --
  let userTemplate: { subject: string; body: string } | null = null;
  if (templateId) {
    const t = await prisma.template.findUnique({ where: { id: templateId } });
    if (!t || (t.userId !== userId && !t.isShared)) return res.status(404).json({ error: "Template not found" });
    userTemplate = { subject: t.subject, body: t.body };
  }

  // -- Resolve sender profile --
  let profile;
  try {
    profile = await resolveProfileForGeneration(userId);
  } catch (err) {
    if (err instanceof ProfileError) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  const senderContext = buildSenderContextFromProfile(profile, { tone, extraContext, includeResumeBullet });

  const saveDraft = async (draft: { subject: string; body: string }) => {
    return prisma.email.create({
      data: {
        ...(savedLeadId ? { userLeadId: savedLeadId } : {}),
        ...(savedContactId ? { contactId: savedContactId } : {}),
        ...(savedCustomContactId ? { customContactId: savedCustomContactId } : {}),
        subject: draft.subject,
        body: draft.body,
        status: "draft",
      },
    });
  };

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
        apiKey: profile.apiKey,
      };

  let draft: { subject: string; body: string };
  let fallback = false;
  let generationError: string | null = null;

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

  let savedEmail = null;
  if (save) {
    try {
      savedEmail = await saveDraft(draft);
    } catch (err) {
      return res.status(500).json({
        error: `Generated email could not be saved: ${(err as Error).message}`,
      });
    }
  }

  return res.status(200).json({
    ...(generationError && { error: generationError }),
    ...(fallback && { fallback: true }),
    subject: draft.subject,
    body: draft.body,
    emailId: savedEmail?.id ?? null,
  });
}

function parseBody(req: VercelRequest): Record<string, unknown> {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body as Record<string, unknown>;
}
