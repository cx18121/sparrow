import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  researchCompanyDossierGtmHybrid,
  researchCompanyDossierOpsHybrid,
  pickGtmAngle,
  pickOpsAngle,
  type GtmDossier,
  type OpsDossier,
} from "../server/lib/ai/research-fit-angle.js";
import { generateEmailDraft } from "../server/lib/ai/generate-email.js";
import { buildSenderContext } from "../server/lib/build-sender-context.js";

// End-to-end smoke for the GTM and Ops pipelines shipped in ADR-0005
// slices 2 + 3. Holds resume + contact constant across N real companies
// and exercises:
//   1. role-specific research (GTM hybrid / Ops Exa /contents)
//   2. role-specific picker (real Claude, token-only)
//   3. generateEmailDraft kind='ai' with the role's personalization pair
// Dumps each draft to console + optionally .scratch/<role>-pipeline.md
// for side-by-side reading. No DB writes — runs without the slice's
// schema migration deployed.
//
// Cost: ~1 search + ~1 synthesis + ~1 picker + ~2 (generation + humanize)
// per company. With defaults (3 companies), expect $0.10–$0.15 total.
//
// Usage:
//   npx tsx scripts/smoke-role-pipeline.ts --role gtm
//   npx tsx scripts/smoke-role-pipeline.ts --role operations --write

const ROLES = ["gtm", "operations"] as const;
type Role = (typeof ROLES)[number];

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

interface CompanyFixture {
  name: string;
  domain: string;
  description: string | null;
  oneLiner: string | null;
  stage: string | null;
  industry: string | null;
  isHiring: boolean;
}

// Per-fixture result: pre-extracted, type-erased rows for the printer so
// the formatter doesn't need to know dossier shape.
interface FixtureResult {
  fixture: CompanyFixture;
  dossierLines: Array<[string, string]>;   // [label, value] e.g. ["triggers", "a; b; c"]
  pickedLines: Array<[string, string]>;
  draft: { subject: string; body: string };
  timingMs: number;
}

// Per-role config: everything that differs between the GTM and Ops smoke
// scripts. `run` is a closure that owns the role-specific research +
// picker + draft-kwargs in one place so the outer loop stays generic.
interface RolePipeline {
  role: Role;
  label: string;                                // "GTM" / "Ops" — for headers + banner
  outputPath: string;                           // .scratch/<role>-pipeline.md
  bannerSlice: string;                          // "ADR-0005 slice 2|3"
  resume: string;
  resumeShape: string;                          // one-line description of resume flavor
  senderName: string;
  contact: { name: string; title: string };
  senderBio: string;                            // role hint baked into buildSenderContext bio
  fixtures: CompanyFixture[];
  run: (fixture: CompanyFixture) => Promise<FixtureResult>;
}

// ── GTM pipeline ──────────────────────────────────────────────────────────

const GTM_RESUME = `
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

const GTM_FIXTURES: CompanyFixture[] = [
  { name: "Linear",  domain: "linear.app",  description: "Project management tool for software teams",      oneLiner: "The issue tracker you'll enjoy using",        stage: "Series C", industry: "Developer Tools", isHiring: true },
  { name: "Ramp",    domain: "ramp.com",    description: "Corporate cards + spend management",              oneLiner: "Finance automation for growing companies",    stage: "Series D", industry: "Fintech",         isHiring: true },
  { name: "Vercel",  domain: "vercel.com",  description: "Frontend cloud platform",                         oneLiner: "Develop. Preview. Ship.",                     stage: "Series E", industry: "Developer Tools", isHiring: true },
];

const gtmPipeline: RolePipeline = {
  role: "gtm",
  label: "GTM",
  outputPath: ".scratch/gtm-pipeline.md",
  bannerSlice: "ADR-0005 slice 2",
  resume: GTM_RESUME,
  resumeShape: "GTM-shaped (sales/growth credentials, no eng projects)",
  senderName: "Casey Park",
  contact: { name: "Jordan Lee", title: "Head of Sales" },
  senderBio: "Tone: direct, concrete. Use one relevant detail from the sender's resume only if it strengthens the email. Make it specific and natural; do not list multiple bullets or invent experience. If the resume includes go-to-market work (sales, marketing, growth, revenue, partnerships, customer wins), prefer that bullet.",
  fixtures: GTM_FIXTURES,
  async run(fixture): Promise<FixtureResult> {
    const t0 = Date.now();
    const dossier = await researchCompanyDossierGtmHybrid({
      company: fixture,
      apiKey: apiKey!,
      exaApiKey,
      tavilyApiKey,
    });
    const picked = await pickGtmAngle({ dossier, resumeText: GTM_RESUME, apiKey: apiKey! });
    const draft = await generateEmailDraft({
      kind: "ai",
      contact: gtmPipeline.contact,
      company: fixture,
      interestHook: null,
      senderContext: buildSenderContext({ name: gtmPipeline.senderName, bio: gtmPipeline.senderBio, resumeText: GTM_RESUME }),
      apiKey: apiKey!,
      subjectTemplate: null,
      senderName: gtmPipeline.senderName,
      triggerLine: picked.triggerLine,
      proofOfMotion: picked.proofOfMotion,
      targetRole: "gtm",
    });
    return {
      fixture,
      dossierLines: gtmDossierLines(dossier),
      pickedLines: [
        ["triggerLine", picked.triggerLine ?? "(none)"],
        ["proofOfMotion", picked.proofOfMotion ?? "(none)"],
      ],
      draft,
      timingMs: Date.now() - t0,
    };
  },
};

function gtmDossierLines(d: GtmDossier): Array<[string, string]> {
  return [
    ["summary",       d.summary || "(empty)"],
    ["triggers",      d.triggers.length      ? d.triggers.join("; ")      : "(none)"],
    ["recentMoves",   d.recentMoves.length   ? d.recentMoves.join("; ")   : "(none)"],
    ["marketSignals", d.marketSignals.length ? d.marketSignals.join("; ") : "(none)"],
  ];
}

// ── Ops pipeline ──────────────────────────────────────────────────────────

const OPS_RESUME = `
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

const OPS_FIXTURES: CompanyFixture[] = [
  { name: "Linear",  domain: "linear.app",  description: "Project management tool for software teams",      oneLiner: "The issue tracker you'll enjoy using",        stage: "Series C", industry: "Developer Tools", isHiring: true },
  { name: "Ramp",    domain: "ramp.com",    description: "Corporate cards + spend management",              oneLiner: "Finance automation for growing companies",    stage: "Series D", industry: "Fintech",         isHiring: true },
  { name: "Notion",  domain: "notion.so",   description: "Workspace for notes + docs + databases",          oneLiner: "All-in-one workspace",                        stage: "Series C", industry: "Productivity",    isHiring: true },
];

const opsPipeline: RolePipeline = {
  role: "operations",
  label: "Ops",
  outputPath: ".scratch/ops-pipeline.md",
  bannerSlice: "ADR-0005 slice 3",
  resume: OPS_RESUME,
  resumeShape: "ops-shaped (Chief of Staff + BizOps credentials)",
  senderName: "Morgan Patel",
  contact: { name: "Sam Rivera", title: "Chief of Staff" },
  senderBio: "Tone: direct, concrete. Use one relevant detail from the sender's resume only if it strengthens the email. Make it specific and natural; do not list multiple bullets or invent experience. If the resume includes operations, finance, people, or process work (scaling teams, hiring, systems, cross-functional execution), prefer that bullet.",
  fixtures: OPS_FIXTURES,
  async run(fixture): Promise<FixtureResult> {
    const t0 = Date.now();
    const dossier = await researchCompanyDossierOpsHybrid({
      company: fixture,
      apiKey: apiKey!,
      exaApiKey,
      tavilyApiKey,
    });
    const picked = await pickOpsAngle({ dossier, resumeText: OPS_RESUME, apiKey: apiKey! });
    const draft = await generateEmailDraft({
      kind: "ai",
      contact: opsPipeline.contact,
      company: fixture,
      interestHook: null,
      senderContext: buildSenderContext({ name: opsPipeline.senderName, bio: opsPipeline.senderBio, resumeText: OPS_RESUME }),
      apiKey: apiKey!,
      subjectTemplate: null,
      senderName: opsPipeline.senderName,
      inflectionLine: picked.inflectionLine,
      systemBuilt: picked.systemBuilt,
      targetRole: "operations",
    });
    return {
      fixture,
      dossierLines: opsDossierLines(dossier),
      pickedLines: [
        ["inflectionLine", picked.inflectionLine ?? "(none)"],
        ["systemBuilt",    picked.systemBuilt    ?? "(none)"],
      ],
      draft,
      timingMs: Date.now() - t0,
    };
  },
};

function opsDossierLines(d: OpsDossier): Array<[string, string]> {
  return [
    ["summary",      d.summary || "(empty)"],
    ["inflections",  d.inflections.length  ? d.inflections.join("; ")  : "(none)"],
    ["recentHires",  d.recentHires.length  ? d.recentHires.join("; ")  : "(none)"],
    ["openRoles",    d.openRoles.length    ? d.openRoles.join("; ")    : "(none)"],
  ];
}

// ── Driver ────────────────────────────────────────────────────────────────

const PIPELINES: Record<Role, RolePipeline> = {
  gtm: gtmPipeline,
  operations: opsPipeline,
};

function parseRole(): Role {
  const idx = process.argv.indexOf("--role");
  const raw = idx !== -1 ? process.argv[idx + 1] : null;
  if (!raw) {
    console.error(`--role is required (one of: ${ROLES.join(" | ")})`);
    process.exit(1);
  }
  if (!ROLES.includes(raw as Role)) {
    console.error(`--role must be one of: ${ROLES.join(" | ")}; got ${raw}`);
    process.exit(1);
  }
  return raw as Role;
}

function formatResult(label: string, r: FixtureResult): string {
  const lines: string[] = [];
  lines.push(`## ${r.fixture.name} — ${r.fixture.industry} (${r.fixture.stage})`);
  lines.push("");
  lines.push(`- domain: ${r.fixture.domain}`);
  lines.push(`- one-liner: ${r.fixture.oneLiner ?? "(none)"}`);
  lines.push(`- pipeline took ${(r.timingMs / 1000).toFixed(1)}s`);
  lines.push("");
  lines.push(`### ${label} dossier`);
  for (const [k, v] of r.dossierLines) lines.push(`- ${k}: ${v}`);
  lines.push("");
  lines.push("### Picked angle");
  for (const [k, v] of r.pickedLines) lines.push(`- ${k}: ${v}`);
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
  const role = parseRole();
  const pipeline = PIPELINES[role];
  const shouldWrite = process.argv.includes("--write");

  console.log(`${pipeline.label} pipeline end-to-end smoke (${pipeline.bannerSlice})`);
  console.log(`Resume: ${pipeline.resumeShape}`);
  console.log(`Contact: ${pipeline.contact.name}, ${pipeline.contact.title}`);
  console.log(`Fixtures: ${pipeline.fixtures.length} real companies`);
  console.log("");

  const sections: string[] = [];
  for (const fixture of pipeline.fixtures) {
    console.log(`> ${fixture.name} (${fixture.domain})`);
    try {
      const result = await pipeline.run(fixture);
      const section = formatResult(pipeline.label, result);
      sections.push(section);
      console.log("");
      console.log(section);
      console.log("");
    } catch (err) {
      console.error(`  FAILED: ${(err as Error).message}`);
      sections.push(`## ${fixture.name} — FAILED\n\n${(err as Error).message}\n`);
    }
  }

  if (shouldWrite) {
    const md = [
      `# ${pipeline.label} pipeline smoke — ${new Date().toISOString()}`,
      "",
      `Resume constant. Contact constant. Each section is a real company researched via the ${pipeline.label} pipeline.`,
      "",
      ...sections,
    ].join("\n");
    await mkdir(dirname(pipeline.outputPath), { recursive: true });
    await writeFile(pipeline.outputPath, md, "utf8");
    console.log(`Wrote ${pipeline.outputPath}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
