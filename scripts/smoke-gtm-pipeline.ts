import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  researchCompanyDossierGtmHybrid,
  pickGtmAngle,
  type GtmDossier,
} from "../server/lib/ai/research-fit-angle.js";
import { generateEmailDraft } from "../server/lib/ai/generate-email.js";
import { buildSenderContext } from "../server/lib/build-sender-context.js";

// End-to-end smoke for the GTM pipeline shipped in ADR-0005 slice 2.
// Holds resume + contact constant across N real companies and exercises:
//   1. researchCompanyDossierGtmHybrid (real Exa with press includeDomains)
//   2. pickGtmAngle (real Claude, token-only)
//   3. generateEmailDraft kind='ai' with the GTM personalization pair
// Dumps each draft to console + optionally .scratch/gtm-pipeline.md for
// side-by-side reading. No DB writes — runs without the slice 2 schema
// migration deployed.
//
// Cost: ~1 Exa call + ~1 synthesis + ~1 picker + ~2 (generation + humanize)
// per company. With defaults (3 companies), expect ~$0.10 total.
//
// Usage:
//   npx tsx scripts/smoke-gtm-pipeline.ts
//   npx tsx scripts/smoke-gtm-pipeline.ts --write

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
const exaApiKey = process.env.EXA_API_KEY?.trim() || null;
const tavilyApiKey = process.env.TAVILY_API_KEY?.trim() || null;

if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}
if (!exaApiKey && !tavilyApiKey) {
  console.error("Neither EXA_API_KEY nor TAVILY_API_KEY is set — research is disabled.");
  process.exit(1);
}

const SHOULD_WRITE = process.argv.includes("--write");
const OUTPUT_PATH = ".scratch/gtm-pipeline.md";

// GTM-shaped resume — sales/growth credentials, not eng projects. The
// picker should anchor PROOF on one of these segments and metrics.
const RESUME = `
Casey Park — BBA Marketing, NYU Stern (graduating 2026).

Selected work:
- First GTM hire at a YC W24 fintech (Series A). Built outbound pipeline from
  scratch — closed 6 pilots in Q1 2026, driving $240k in first-year ARR.
  Owned cold outreach + discovery + onboarding hand-off.
- Growth intern at Ramp summer 2025. Ran 4 multivariate experiments on the
  signup funnel; the winning variant lifted activation 18 pp on the mid-market
  cohort and shipped to GA.
- Founded campus consulting club (4 to 22 members over 2 semesters). Ran the
  inbound funnel for our pro-bono client work.
`.trim();

const SENDER_NAME = "Casey Park";
const CONTACT = { name: "Jordan Lee", title: "Head of Sales" };

interface CompanyFixture {
  name: string;
  domain: string;
  description: string | null;
  oneLiner: string | null;
  stage: string | null;
  industry: string | null;
  isHiring: boolean;
}

// Three real GTM-rich companies. Selected for:
//   - recent press coverage (funding / hires / launches in last 90 days)
//   - varied industries so the GTM signals look different
//   - public-facing enough that Exa + press domains hit the right material
const FIXTURES: CompanyFixture[] = [
  {
    name: "Linear",
    domain: "linear.app",
    description: "Project management tool for software teams",
    oneLiner: "The issue tracker you'll enjoy using",
    stage: "Series C",
    industry: "Developer Tools",
    isHiring: true,
  },
  {
    name: "Ramp",
    domain: "ramp.com",
    description: "Corporate cards + spend management",
    oneLiner: "Finance automation for growing companies",
    stage: "Series D",
    industry: "Fintech",
    isHiring: true,
  },
  {
    name: "Vercel",
    domain: "vercel.com",
    description: "Frontend cloud platform",
    oneLiner: "Develop. Preview. Ship.",
    stage: "Series E",
    industry: "Developer Tools",
    isHiring: true,
  },
];

interface FixtureResult {
  fixture: CompanyFixture;
  dossier: GtmDossier;
  picked: { triggerLine: string | null; proofOfMotion: string | null };
  draft: { subject: string; body: string };
  timingMs: number;
}

async function runFixture(fixture: CompanyFixture): Promise<FixtureResult> {
  const t0 = Date.now();
  const dossier = await researchCompanyDossierGtmHybrid({
    company: fixture,
    apiKey: apiKey!,
    exaApiKey,
    tavilyApiKey,
  });
  const picked = await pickGtmAngle({
    dossier,
    resumeText: RESUME,
    apiKey: apiKey!,
  });
  const draft = await generateEmailDraft({
    kind: "ai",
    contact: CONTACT,
    company: fixture,
    interestHook: null,
    senderContext: buildSenderContext({
      name: SENDER_NAME,
      bio: "Tone: direct, concrete. Use one relevant detail from the sender's resume only if it strengthens the email. Make it specific and natural; do not list multiple bullets or invent experience. If the resume includes go-to-market work (sales, marketing, growth, revenue, partnerships, customer wins), prefer that bullet.",
      resumeText: RESUME,
    }),
    apiKey: apiKey!,
    subjectTemplate: null,
    senderName: SENDER_NAME,
    triggerLine: picked.triggerLine,
    proofOfMotion: picked.proofOfMotion,
    targetRole: "gtm",
  });
  return { fixture, dossier, picked, draft, timingMs: Date.now() - t0 };
}

function formatResult(r: FixtureResult): string {
  const lines: string[] = [];
  lines.push(`## ${r.fixture.name} — ${r.fixture.industry} (${r.fixture.stage})`);
  lines.push("");
  lines.push(`- domain: ${r.fixture.domain}`);
  lines.push(`- one-liner: ${r.fixture.oneLiner ?? "(none)"}`);
  lines.push(`- pipeline took ${(r.timingMs / 1000).toFixed(1)}s`);
  lines.push("");
  lines.push("### GTM dossier");
  lines.push(`- summary: ${r.dossier.summary || "(empty)"}`);
  lines.push(`- triggers: ${r.dossier.triggers.length ? r.dossier.triggers.join("; ") : "(none)"}`);
  lines.push(`- recentMoves: ${r.dossier.recentMoves.length ? r.dossier.recentMoves.join("; ") : "(none)"}`);
  lines.push(`- marketSignals: ${r.dossier.marketSignals.length ? r.dossier.marketSignals.join("; ") : "(none)"}`);
  lines.push("");
  lines.push("### Picked angle");
  lines.push(`- triggerLine: ${r.picked.triggerLine ?? "(none)"}`);
  lines.push(`- proofOfMotion: ${r.picked.proofOfMotion ?? "(none)"}`);
  lines.push("");
  lines.push("### Draft");
  lines.push(`- subject: ${r.draft.subject}`);
  lines.push("");
  lines.push("```");
  lines.push(r.draft.body);
  lines.push("```");
  return lines.join("\n");
}

async function main() {
  console.log("GTM pipeline end-to-end smoke (ADR-0005 slice 2)");
  console.log(`Resume: GTM-shaped (sales/growth credentials, no eng projects)`);
  console.log(`Contact: ${CONTACT.name}, ${CONTACT.title}`);
  console.log(`Fixtures: ${FIXTURES.length} real companies`);
  console.log("");

  const sections: string[] = [];
  for (const fixture of FIXTURES) {
    console.log(`> ${fixture.name} (${fixture.domain})`);
    try {
      const result = await runFixture(fixture);
      const section = formatResult(result);
      sections.push(section);
      console.log("");
      console.log(section);
      console.log("");
    } catch (err) {
      console.error(`  FAILED: ${(err as Error).message}`);
      sections.push(`## ${fixture.name} — FAILED\n\n${(err as Error).message}\n`);
    }
  }

  if (SHOULD_WRITE) {
    const md = [
      `# GTM pipeline smoke — ${new Date().toISOString()}`,
      "",
      `Resume constant. Contact constant. Each section is a real company researched via the GTM hybrid pipeline.`,
      "",
      ...sections,
    ].join("\n");
    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, md, "utf8");
    console.log(`Wrote ${OUTPUT_PATH}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
