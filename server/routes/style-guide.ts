import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { resolveProfileForGeneration, ProfileError } from "../lib/sender-profile.js";
import { callClaude } from "../lib/ai/anthropic.js";
import { parseBody } from "../lib/parse-params.js";
import { sendRouteError } from "../lib/route-error.js";

const MODEL = "claude-haiku-4-5-20251001";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const body = parseBody(req) ?? {};
    const { examples } = body as { examples?: unknown };

    if (!Array.isArray(examples) || examples.length === 0) {
      return res.status(400).json({ error: "examples array is required" });
    }

    const validExamples = examples
      .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
      .slice(0, 6);

    if (validExamples.length === 0) {
      return res.status(400).json({ error: "No valid example strings provided" });
    }

    let profile;
    try {
      profile = await resolveProfileForGeneration(userId);
    } catch (err) {
      if (err instanceof ProfileError) return res.status(err.status).json({ error: err.message });
      throw err;
    }

    const exampleText = validExamples
      .map((body, i) => `Example ${i + 1}:\n${body}`)
      .join("\n\n");

    const prompt = `Here are ${validExamples.length} email samples that represent a user's preferred writing style. They chose these from a style quiz:\n\n${exampleText}\n\nWrite a 2–3 sentence style guide that captures what makes this style distinct. Be specific and concrete about: sentence length, how the email opens, tone, and how the ask is framed. This guide will instruct an AI to write emails in this exact style. Output only the style guide, nothing else.`;

    let guide: string;
    try {
      guide = await callClaude({ apiKey: profile.apiKey, model: MODEL, userContent: prompt, maxTokens: 200 });
    } catch {
      return res.status(502).json({ error: "Could not generate style guide" });
    }

    if (!guide) return res.status(500).json({ error: "Empty response from Claude" });

    return res.status(200).json({ guide });
  } catch (err) {
    return sendRouteError(res, err);
  }
}
