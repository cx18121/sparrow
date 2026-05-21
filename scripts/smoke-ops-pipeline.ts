import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  researchCompanyDossierOpsHybrid,
  pickOpsAngle,
  type OpsDossier,
} from "../server/lib/ai/research-fit-angle.js";
import { generateEmailDraft } from "../server/lib/ai/generate-email.js";
import { buildSenderContext } from "../server/lib/build-sender-context.js";

// End-to-end smoke for the ops pipeline shipped in ADR-0005 slice 3.
// Holds resume + contact constant across N real companies and exercises:
//   1. researchCompanyDossierOpsHybrid (real Exa /contents on /careers,
//      /team, /about, /jobs subpages — no /search arm, no domain filter)
//   2. pickOpsAngle (real Claude, token-only)
//   3. generateEmailDraft kind='ai' with the ops personalization pair
// Dumps each draft to console + optionally .scratch/ops-pipeline.md for
// side-by-side reading. No DB writes — runs without the slice 3 schema
// migration deployed.
//
// Cost: ~1 Exa /contents call + ~1 synthesis + ~1 picker + ~2 (generation
// + humanize) per company. With defaults (3 companies), expect ~$0.15.
//
// Usage:
//   npx tsx scripts/smoke-ops-pipeline.ts
//   npx tsx scripts/smoke-ops-pipeline.ts --write

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
const OUTPUT_PATH = ".scratch/ops-pipeline.md";

// Ops-shaped resume — operational credentials, not eng projects or GTM
// metrics. The picker should anchor SYSTEM on a function the candidate
// stood up or a process they owned.
const RESUME = `
Morgan Patel — BA Cognitive Science, Brown (graduating 2026).

Selected work:
- Chief of Staff to CEO at a YC W24 seed-stage SaaS (12 → 28 headcount
  during my year). Owned hiring pipeline (ATS, interview loop, calibration),
  the weekly operating cadence, and quarterly OKR rollout. Stood up the
  first People function — wrote leveling, comp bands, and onboarding.
- BizOps intern at a Series A fintech summer 2025. Ran the monthly close
  alongside the head of finance, mapped revenue across 3 product lines,
  and built the first vendor-spend dashboard.
- Co-led RA training program (~40 RAs over 2 semesters): wrote curriculum,
  built calibration rubric, ran biweekly check-ins.
`.trim();

const SENDER_NAME = "Morgan Patel";
const CONTACT = { name: "Sam Rivera", title: "Chief of Staff" };

interface CompanyFixture {
  name: string;
  domain: string;
  description: string | null;
  oneLiner: string | null;
  stage: string | null;
  industry: string | null;
  isHiring: boolean;
}

// Three real companies with public /careers + /team pages of varying depth.
// Selected so the ops pipeline gets different signal density per company:
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
    name: "Notion",
    domain: "notion.so",
    description: "Workspace for notes + docs + databases",
    oneLiner: "All-in-one workspace",
    stage: "Series C",
    industry: "Productivity",
    isHiring: true,
  },
];

interface FixtureResult {
  fixture: CompanyFixture;
  dossier: OpsDossier;
  picked: { inflectionLine: string | null; systemBuilt: string | null };
  draft: { subject: string; body: string };
  timingMs: number;
}

async function runFixture(fixture: CompanyFixture): Promise<FixtureResult> {
  const t0 = Date.now();
  const dossier = await researchCompanyDossierOpsHybrid({
    company: fixture,
    apiKey: apiKey!,
    exaApiKey,
    tavilyApiKey,
  });
  const picked = await pickOpsAngle({
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
      bio: "Tone: direct, concrete. Use one relevant detail from the sender's resume only if it strengthens the email. Make it specific and natural; do not list multiple bullets or invent experience. If the resume includes operations, finance, people, or process work (scaling teams, hiring, systems, cross-functional execution), prefer that bullet.",
      resumeText: RESUME,
    }),
    apiKey: apiKey!,
    subjectTemplate: null,
    senderName: SENDER_NAME,
    inflectionLine: picked.inflectionLine,
    systemBuilt: picked.systemBuilt,
    targetRole: "operations",
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
  lines.push("### Ops dossier");
  lines.push(`- summary: ${r.dossier.summary || "(empty)"}`);
  lines.push(`- inflections: ${r.dossier.inflections.length ? r.dossier.inflections.join("; ") : "(none)"}`);
  lines.push(`- recentHires: ${r.dossier.recentHires.length ? r.dossier.recentHires.join("; ") : "(none)"}`);
  lines.push(`- openRoles: ${r.dossier.openRoles.length ? r.dossier.openRoles.join("; ") : "(none)"}`);
  lines.push("");
  lines.push("### Picked angle");
  lines.push(`- inflectionLine: ${r.picked.inflectionLine ?? "(none)"}`);
  lines.push(`- systemBuilt: ${r.picked.systemBuilt ?? "(none)"}`);
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
  console.log("Ops pipeline end-to-end smoke (ADR-0005 slice 3)");
  console.log(`Resume: ops-shaped (Chief of Staff + BizOps credentials)`);
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
      `# Ops pipeline smoke — ${new Date().toISOString()}`,
      "",
      `Resume constant. Contact constant. Each section is a real company researched via the ops hybrid pipeline (/contents on /careers, /team, /about, /jobs).`,
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
