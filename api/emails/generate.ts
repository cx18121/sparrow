import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../_lib/prisma.js";
import { getSupabaseAdmin, getUserIdFromRequest } from "../_lib/supabaseAdmin.js";
import { decrypt } from "../_lib/crypto.js";
import { generateEmailDraft, GENERIC_FALLBACK_SUBJECT, GENERIC_FALLBACK_BODY } from "../_lib/ai/generate-email.js";
import { buildSenderContext } from "../_lib/build-sender-context.js";
import axios from "axios";

type GenerateBody = {
  userLeadId?: string;
  customContactId?: string;
  templateId?: string;
  interestHook?: string;
  tone?: string;
  extraContext?: string;
  includeResumeBullet?: boolean;
  model?: string;
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

  // -- Resolve contact and company info from either source --
  let contactInfo: { name: string | null; title: string | null } = { name: null, title: null };
  let companyInfo: {
    name: string;
    description: string | null;
    oneLiner: string | null;
    stage: string | null;
    industry: string | null;
    isHiring: boolean;
  } = { name: "", description: null, oneLiner: null, stage: null, industry: null, isHiring: false };
  let savedLeadId: string | null = null;
  let savedContactId: string | null = null;
  let savedCustomContactId: string | null = null;

  if (customContactId) {
    const cc = await prisma.customContact.findUnique({ where: { id: customContactId } });
    if (!cc || cc.userId !== userId) {
      return res.status(404).json({ error: "Custom contact not found" });
    }
    contactInfo = { name: cc.name, title: cc.title };
    companyInfo.name = cc.companyName ?? "";
    savedCustomContactId = cc.id;
  } else {
    // userLeadId path
    const lead = await prisma.userLead.findUnique({
      where: { id: userLeadId! },
      include: { company: true, contact: true },
    });
    if (!lead || lead.userId !== userId) {
      return res.status(404).json({ error: "Lead not found" });
    }

    let contact = lead.contact;
    if (!contact && lead.apolloPersonId) {
      const apolloKey = process.env.APOLLO_API_KEY;
      if (apolloKey) {
        try {
          const revealed = await revealApolloContact(lead.apolloPersonId, apolloKey);
          if (revealed?.email) {
            const saved = await prisma.contact.upsert({
              where: { email: revealed.email },
              create: {
                companyId: lead.companyId,
                name: revealed.name ?? null,
                email: revealed.email,
                title: revealed.title ?? null,
                role: null,
                linkedinUrl: revealed.linkedin_url ?? null,
                source: "apollo",
              },
              update: {
                name: revealed.name ?? null,
                title: revealed.title ?? null,
                linkedinUrl: revealed.linkedin_url ?? null,
                lastVerifiedAt: new Date(),
              },
            });
            await prisma.userLead.update({
              where: { id: lead.id },
              data: { contactId: saved.id },
            });
            contact = saved;
          }
        } catch (err) {
          console.warn("Apollo reveal failed, proceeding without contact:", err);
        }
      }
    }
    if (!contact) {
      return res.status(400).json({
        error: "Lead has no contact. Save a lead from Discover to get contact details.",
      });
    }

    contactInfo = { name: contact.name, title: contact.title };
    companyInfo = {
      name: lead.company.name,
      description: lead.company.description,
      oneLiner: lead.company.oneLiner,
      stage: lead.company.stage,
      industry: lead.company.industry,
      isHiring: lead.company.isHiring,
    };
    savedLeadId = lead.id;
    savedContactId = contact.id;
  }

  // -- Resolve template --
  let userTemplate: { subject: string; body: string } | null = null;
  if (templateId) {
    const t = await prisma.template.findUnique({ where: { id: templateId } });
    if (!t || (t.userId !== userId && !t.isShared)) {
      return res.status(404).json({ error: "Template not found" });
    }
    userTemplate = { subject: t.subject, body: t.body };
  }

  // -- Resolve sender profile --
  const supabase = getSupabaseAdmin();
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("resume_text, claude_api_key_encrypted, workspace_config")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) return res.status(500).json({ error: profileError.message });
  if (!profile?.claude_api_key_encrypted) {
    return res.status(400).json({
      error: "Add a Claude API key in Settings before generating emails.",
    });
  }

  let apiKey: string;
  try {
    apiKey = decrypt(profile.claude_api_key_encrypted);
  } catch {
    return res.status(500).json({ error: "We could not read your saved Claude key. Re-enter it in Settings." });
  }

  const resumeBulletInstruction = includeResumeBullet
    ? "Use one relevant detail from the sender's resume only if it strengthens the email. Make it specific and natural; do not list multiple bullets or invent experience."
    : null
  const extraParts = [tone ? `Tone: ${tone}` : null, resumeBulletInstruction, extraContext ?? null]
    .filter(Boolean)
    .join('. ')

  const ws = (profile.workspace_config ?? {}) as Record<string, any>
  const styleInstruction = typeof ws.styleProfile?.prompt === "string"
    ? ws.styleProfile.prompt
    : Array.isArray(ws.styleProfile?.traits)
      ? `Write in this preferred style: ${ws.styleProfile.traits.join(", ")}.`
      : null
  const senderContext = buildSenderContext({
    name: ws.senderName ?? null,
    bio: [ws.senderRole, extraParts].filter(Boolean).join('. ') || null,
    targetRole: ws.senderRole ?? null,
    resumeText: profile.resume_text ?? null,
  })

  try {
    const draft = await generateEmailDraft({
      contact: { name: contactInfo.name, title: contactInfo.title },
      company: companyInfo,
      interestHook: interestHook ?? null,
      userTemplate: userTemplate?.body ?? null,
      senderContext,
      styleInstruction,
      subjectTemplate: userTemplate?.subject ?? null,
      senderName: ws.senderName ?? null,
      apiKey,
    })

    let savedEmail = null;
    if (save) {
      try {
        savedEmail = await prisma.email.create({
          data: {
            ...(savedLeadId ? { userLeadId: savedLeadId } : {}),
            ...(savedContactId ? { contactId: savedContactId } : {}),
            ...(savedCustomContactId ? { customContactId: savedCustomContactId } : {}),
            subject: draft.subject,
            body: draft.body,
            status: "draft",
          },
        });
      } catch (err) {
        console.warn("Failed to save generated email:", err);
      }
    }

    return res.status(200).json({
      subject: draft.subject,
      body: draft.body,
      emailId: savedEmail?.id ?? null,
    });
  } catch (err) {
    const contactName = contactInfo.name ?? "there";
    const companyName = companyInfo.name;
    return res.status(502).json({
      error: (err as Error).message,
      subject: GENERIC_FALLBACK_SUBJECT,
      body: GENERIC_FALLBACK_BODY(contactName, companyName),
    });
  }
}

function parseBody(req: VercelRequest): Record<string, unknown> {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body as Record<string, unknown>;
}

async function revealApolloContact(personId: string, apiKey: string): Promise<{
  name: string;
  email: string;
  title: string | null;
  linkedin_url: string | null;
} | null> {
  try {
    const response = await axios.post(
      "https://api.apollo.io/api/v1/people/match",
      { id: personId, reveal_personal_emails: false },
      {
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        timeout: 10_000,
      }
    );
    return response.data.person ?? null;
  } catch {
    return null;
  }
}
