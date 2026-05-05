import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUserIdFromRequest } from "../lib/supabaseAdmin.js";
import { parseBody } from "../lib/parse-params.js";
import { sendRouteError } from "../lib/route-error.js";
import { pickFitAngle, type CompanyDossier } from "../lib/ai/research-fit-angle.js";

// Pre-baked Anthropic dossier used by the onboarding template preview.
// Frozen from a real Exa run on anthropic.com — these are actual product
// surfaces, not invented copy. We don't re-fetch this per preview call
// because (a) the recipient is fixed in onboarding, (b) refetching on every
// keystroke would be wasteful, and (c) Anthropic's surface set is stable
// enough that monthly drift is fine for a non-production preview.
//
// REFRESH POLICY: re-bake this constant ~once a quarter, or whenever a
// major Anthropic launch makes the listed surfaces feel stale. Easiest
// way: `npx tsx scripts/smoke-exa-vs-tavily.ts --domain anthropic.com`
// and copy the Exa dossier output into the values below. There's no
// automation for this yet — the staleness cost is "preview cites old
// product names," not a real bug, so manual is fine.
//
// pickFitAngle stays the real model-picked path. The user types a resume,
// we surface which Anthropic feature their resume best fits — same logic
// production runs against any recipient.
const ANTHROPIC_PREVIEW_DOSSIER: CompanyDossier = {
  summary:
    "AI safety company building Claude — agentic, multimodal large language models at the frontier of capability and alignment.",
  surfaces: [
    "claude opus 4.7 llm",
    "claude code agentic coding",
    "claude design visual prototyping tool",
    "claude enterprise self-serve purchasing",
    "personal app connectors",
    "claude cowork team collaboration",
    "cyber verification program",
  ],
  recentLaunches: [
    "claude opus 4.7 general availability",
    "claude design ai prototyping tool",
    "enterprise self-serve purchasing",
    "personal app connectors ecosystem",
  ],
  technicalAreas: [
    "long-horizon agentic task execution",
    "multimodal vision at scale",
    "computer use and tool orchestration",
    "output verification and self-checking",
    "constitutional ai alignment",
  ],
};

const MAX_RESUME_LENGTH = 100_000; // matches /api/profile cap

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      // No host key configured — return nulls so the UI can fall back to
      // its placeholder values without surfacing an error to the user.
      return res.status(200).json({ featureLine: null, fitAngle: null });
    }

    const body = parseBody(req);
    const rawResume = (body as { resumeText?: unknown })?.resumeText;
    if (typeof rawResume !== "string") {
      return res.status(400).json({ error: "resumeText must be a string" });
    }
    if (rawResume.length > MAX_RESUME_LENGTH) {
      return res.status(400).json({ error: "resumeText is too long" });
    }
    const resumeText = rawResume.trim();
    if (resumeText.length === 0) {
      // Empty resume → nothing for pickFitAngle to anchor against.
      // Short-circuit instead of paying for a guaranteed-NONE call.
      return res.status(200).json({ featureLine: null, fitAngle: null });
    }

    const result = await pickFitAngle({
      dossier: ANTHROPIC_PREVIEW_DOSSIER,
      resumeText,
      apiKey,
    });
    return res.status(200).json(result);
  } catch (err) {
    return sendRouteError(res, err);
  }
}
