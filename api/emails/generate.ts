import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../_lib/prisma.js";
import { getSupabaseAdmin, getUserIdFromRequest } from "../_lib/supabaseAdmin.js";
import { decrypt } from "../_lib/crypto.js";
import { generateEmailDraft, GENERIC_FALLBACK_SUBJECT, GENERIC_FALLBACK_BODY } from "../_lib/ai/generate-email.js";
import { buildSenderContext } from "../_lib/build-sender-context.js";
import axios from "axios";

type GenerateBody = {
  userLeadId?: string;
  templateId?: string;
  interestHook?: string;
  tone?: string;
  extraContext?: string;
  model?: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = parseBody(req) as GenerateBody;
  const { userLeadId, templateId, interestHook, tone, extraContext } = body;

  if (!userLeadId) return res.status(400).json({ error: "userLeadId is required" });

  const lead = await prisma.userLead.findUnique({
    where: { id: userLeadId },
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

  let userTemplate: { subject: string; body: string } | null = null;
  if (templateId) {
    const t = await prisma.template.findUnique({ where: { id: templateId } });
    if (!t || (t.userId !== userId && !t.isShared)) {
      return res.status(404).json({ error: "Template not found" });
    }
    userTemplate = { subject: t.subject, body: t.body };
  }

  const supabase = getSupabaseAdmin();
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("resume_text, claude_api_key_encrypted, workspace_config")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) return res.status(500).json({ error: profileError.message });
  if (!profile?.claude_api_key_encrypted) {
    return res.status(400).json({
      error: "Claude API key not configured. Add one in Settings.",
    });
  }

  let apiKey: string;
  try {
    apiKey = decrypt(profile.claude_api_key_encrypted);
  } catch {
    return res.status(500).json({ error: "Unable to decrypt Claude API key" });
  }

  const extraParts = [tone ? `Tone: ${tone}` : null, extraContext ?? null]
    .filter(Boolean)
    .join('. ')

  const ws = (profile.workspace_config ?? {}) as Record<string, any>
  const senderContext = buildSenderContext({
    name: ws.senderName ?? null,
    bio: [ws.senderRole, extraParts].filter(Boolean).join('. ') || null,
    targetRole: ws.senderRole ?? null,
    resumeText: profile.resume_text ?? null,
  })

  try {
    const draft = await generateEmailDraft({
      contact: { name: contact.name, title: contact.title },
      company: {
        name: lead.company.name,
        description: lead.company.description,
        oneLiner: lead.company.oneLiner,
        stage: lead.company.stage,
        industry: lead.company.industry,
        isHiring: lead.company.isHiring,
      },
      interestHook: interestHook ?? null,
      userTemplate: userTemplate?.body ?? null,
      senderContext,
      subjectTemplate: userTemplate?.subject ?? null,
      senderName: ws.senderName ?? null,
      apiKey,
    })

    let savedEmail = null;
    try {
      const existing = await prisma.email.findFirst({
        where: { userLeadId: lead.id, contactId: contact.id, status: "draft" },
      });
      if (existing) {
        savedEmail = await prisma.email.update({
          where: { id: existing.id },
          data: { subject: draft.subject, body: draft.body },
        });
      } else {
        savedEmail = await prisma.email.create({
          data: {
            userLeadId: lead.id,
            contactId: contact.id,
            subject: draft.subject,
            body: draft.body,
            status: "draft",
          },
        });
      }
    } catch (err) {
      console.warn("Failed to save generated email:", err);
    }

    return res.status(200).json({
      subject: draft.subject,
      body: draft.body,
      emailId: savedEmail?.id ?? null,
    });
  } catch (err) {
    const contactName = contact.name ?? "there";
    const companyName = lead.company.name;
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
