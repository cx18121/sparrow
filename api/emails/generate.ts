import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "../_lib/prisma.js";
import { getSupabaseAdmin, getUserIdFromRequest } from "../_lib/supabaseAdmin.js";
import { decrypt } from "../_lib/crypto.js";

type GenerateBody = {
  userLeadId?: string;
  templateId?: string;
  tone?: string;
  extraContext?: string;
  model?: string;
};

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const body = parseBody(req) as GenerateBody;
  const { userLeadId, templateId, tone, extraContext, model } = body;

  if (!userLeadId) return res.status(400).json({ error: "userLeadId is required" });

  const lead = await prisma.userLead.findUnique({
    where: { id: userLeadId },
    include: {
      company: true,
      contact: true,
    },
  });
  if (!lead || lead.userId !== userId) {
    return res.status(404).json({ error: "Lead not found" });
  }
  if (!lead.contact) {
    return res.status(400).json({ error: "Lead has no contact attached" });
  }

  let template: { name: string; subject: string; body: string } | null = null;
  if (templateId) {
    const t = await prisma.template.findUnique({ where: { id: templateId } });
    if (!t || (t.userId !== userId && !t.isShared)) {
      return res.status(404).json({ error: "Template not found" });
    }
    template = { name: t.name, subject: t.subject, body: t.body };
  }

  const supabase = getSupabaseAdmin();
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("resume_text, claude_api_key_encrypted")
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

  const context = buildContext({
    contact: lead.contact,
    company: lead.company,
    resume: profile.resume_text ?? null,
    template,
    tone,
    extraContext,
  });

  try {
    const generated = await callAnthropic({
      apiKey,
      model: model || DEFAULT_MODEL,
      system: SYSTEM_PROMPT,
      userMessage: context,
    });
    return res.status(200).json({
      subject: generated.subject,
      body: generated.body,
      model: model || DEFAULT_MODEL,
    });
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  }
}

const SYSTEM_PROMPT = `You write short, specific, non-salesy cold outreach emails for a job-seeking candidate reaching out to people at companies they want to work for.

Rules:
- Under 130 words in the body.
- Reference something concrete about the company (stage, product, industry, region, hiring status) — never generic flattery.
- Connect the candidate's background to the company's needs in one sentence. Do not list the candidate's whole resume.
- No corporate jargon, no "I hope this finds you well", no "circling back".
- Subject lines under 60 characters, lowercase or sentence case, curiosity-driven, never clickbait.
- If data is missing, write around it — never make up facts or fabricate metrics.
- First-person, warm, direct. Sign off with just the candidate's first name if available, otherwise no signoff.

Output MUST be a single JSON object of the form:
{"subject": "...", "body": "..."}
No prose before or after. No markdown fencing.`;

function buildContext(args: {
  contact: {
    name: string | null;
    email: string | null;
    title: string | null;
    role: string | null;
    linkedinUrl: string | null;
  };
  company: {
    name: string;
    domain: string;
    description: string | null;
    oneLiner: string | null;
    website: string | null;
    stage: string | null;
    industry: string | null;
    subIndustry: string | null;
    location: string | null;
    region: string | null;
    headcount: number | null;
    isHiring: boolean;
    batch: string | null;
  };
  resume: string | null;
  template: { name: string; subject: string; body: string } | null;
  tone?: string;
  extraContext?: string;
}): string {
  const parts: string[] = [];

  parts.push("## Contact");
  parts.push(JSON.stringify(compact(args.contact), null, 2));

  parts.push("\n## Company");
  parts.push(JSON.stringify(compact(args.company), null, 2));

  if (args.resume) {
    const trimmed = args.resume.slice(0, 6000);
    parts.push("\n## Candidate resume");
    parts.push(trimmed);
  }

  if (args.template) {
    parts.push("\n## Base template (adapt, do not copy verbatim)");
    parts.push(`Subject: ${args.template.subject}`);
    parts.push(`Body:\n${args.template.body}`);
  }

  if (args.tone) {
    parts.push(`\n## Tone\n${args.tone}`);
  }
  if (args.extraContext) {
    parts.push(`\n## Extra context from candidate\n${args.extraContext}`);
  }

  parts.push(
    "\nReturn a single JSON object: {\"subject\": \"...\", \"body\": \"...\"}.",
  );
  return parts.join("\n");
}

function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

async function callAnthropic(args: {
  apiKey: string;
  model: string;
  system: string;
  userMessage: string;
}): Promise<{ subject: string; body: string }> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": args.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: 1024,
      system: args.system,
      messages: [
        { role: "user", content: args.userMessage },
        { role: "assistant", content: "{" },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${text}`);
  }

  const data = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const textBlock = data.content?.find((c) => c.type === "text")?.text ?? "";
  const jsonText = `{${textBlock}`;

  let parsed: { subject?: unknown; body?: unknown };
  try {
    parsed = JSON.parse(extractJson(jsonText));
  } catch (err) {
    throw new Error(`Claude returned non-JSON response: ${(err as Error).message}`);
  }

  if (typeof parsed.subject !== "string" || typeof parsed.body !== "string") {
    throw new Error("Claude response missing subject or body");
  }
  return { subject: parsed.subject, body: parsed.body };
}

function extractJson(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return s;
  return s.slice(start, end + 1);
}

function parseBody(req: VercelRequest): Record<string, unknown> {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body as Record<string, unknown>;
}
