import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pickFitAngle, type CompanyDossier } from "../server/lib/ai/research-fit-angle.js";
import { generateEmailDraft } from "../server/lib/ai/generate-email.js";
import { buildSenderContext } from "../server/lib/build-sender-context.js";
import {
  ROLE_FAMILIES,
  type RoleFamily,
} from "../src/types/roleFamilies.js";

// Side-by-side eval for the per-role generation pass.
//
// Holds resume + dossier + contact constant across all 4 role families,
// varies only the targetRole. Lets you read the 4 role versions of the same
// email and judge whether the role steer actually changed the draft in a
// useful direction. Built to back the iterate-from-output decision in the
// per-role generation handoff (positive-only steer first; tighten to
// positive+negative only if the smoke shows drafts staying mis-targeted).
//
// What varies per role:
//   - pickFitAngle: picks a different surface from the same dossier when the
//     role hint shifts the tiebreaker (e.g. eng prefers technical surfaces,
//     gtm prefers revenue/growth surfaces).
//   - sender context resumeBulletInstruction: a role-specific "prefer X
//     bullets" hint nudges the model toward an on-tag resume detail.
//   - generation system prompt: a one-line voice steer ("favor technical
//     specificity" vs "favor outcomes and motion") shapes the rewrite tone.
//
// Cost: ~12 fit-angle calls + ~12 generation × 2 (humanize) = ~36 Claude
// calls per dossier × per-resume run. With defaults (3 dossiers, 1 resume,
// 4 roles), expect ~$1 against Anthropic + 0 Exa/Tavily/Apollo spend.
//
// Usage:
//   npx tsx scripts/smoke-role-drafts.ts                   # console output
//   npx tsx scripts/smoke-role-drafts.ts --write           # also write .scratch/role-drafts.md

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to .env or your shell.");
  process.exit(1);
}

const args = process.argv.slice(2);
const SHOULD_WRITE = args.includes("--write");
const OUTPUT_PATH = ".scratch/role-drafts.md";

// One cross-functional resume so role-specific bullet selection is visible.
// Each bullet maps cleanly to one family — if the role steer is doing its
// job, we should see the GTM draft surface the "drove $2M ARR" bullet and
// the eng draft surface the "multi-agent eval harness" bullet.
const RESUME = `
Charles Xue — CS & Statistics @ Cornell University.

Selected work:
- ENG: Built a multi-agent eval harness with deterministic replay — reduced flaky
  agent benchmark scores by 60% by pinning seed + tool order across runs.
- PRODUCT: Designed and shipped a self-serve dashboard for an internal LLM ops
  team; weekly active users grew from 12 to 80 in two months after redesign.
- GTM: Ran sales outreach for a YC fintech as the first GTM hire; sourced and
  closed 6 pilots in the first quarter, driving ~$240k in first-year ARR.
- OPS: Stood up the hiring pipeline + ATS for a 4-person seed-stage team;
  scaled the founding eng org from 4 to 14 over 8 months without churn.
`.trim();

const SENDER_NAME = "Charles Xue";

const CONTACT = { name: "Sarah Chen", title: "Head of Operations" };

// Three pre-baked dossiers spanning archetypes Sparrow targets. The values
// mirror the shape researchCompanyDossier emits in production (summary +
// surfaces + recentLaunches + technicalAreas). Stubbed so the smoke runs
// without burning Exa/Tavily credits — retrieval quality is its own eval
// (smoke-exa-vs-tavily.ts); this script isolates role steer effect alone.
interface Fixture {
  label: string;
  company: {
    name: string;
    description: string | null;
    oneLiner: string | null;
    stage: string | null;
    industry: string | null;
    isHiring: boolean;
    domain: string;
  };
  dossier: CompanyDossier;
}

const FIXTURES: Fixture[] = [
  {
    label: "dev-tools (technical surface)",
    company: {
      name: "Forge",
      domain: "forge.dev",
      description: "Build infrastructure for AI agents",
      oneLiner: "The CI/CD platform for AI agent workflows",
      stage: "Series A",
      industry: "Developer Tools",
      isHiring: true,
    },
    dossier: {
      summary:
        "Forge is building CI/CD-style infrastructure for AI agents — deterministic replays, eval harnesses, and observability across multi-agent runs.",
      surfaces: [
        "deterministic agent replay engine",
        "self-hosted eval harness",
        "agent observability dashboards",
      ],
      recentLaunches: [
        "Replay v2 with cross-model trace diffing",
        "self-serve eval harness for OSS users",
      ],
      technicalAreas: ["tracing", "multi-agent runtimes", "eval frameworks"],
    },
  },
  {
    label: "consumer-product (UX surface)",
    company: {
      name: "Lumen",
      domain: "uselumen.app",
      description: "AI-native note-taking for students",
      oneLiner: "Notion meets a tutor",
      stage: "Seed",
      industry: "Consumer EdTech",
      isHiring: true,
    },
    dossier: {
      summary:
        "Lumen is a student-facing AI note-taking app — bringing inline tutoring, flashcard generation, and study planning into a unified workspace.",
      surfaces: [
        "AI flashcard generation from notes",
        "study-plan scheduling UI",
        "weekly progress recap email",
      ],
      recentLaunches: [
        "redesigned onboarding cut day-1 drop-off in half",
        "new mobile companion app for iOS",
      ],
      technicalAreas: ["mobile UX", "recommendation feedback loops"],
    },
  },
  {
    label: "b2b-saas (revenue surface)",
    company: {
      name: "Pipeline",
      domain: "pipeline.so",
      description: "Outbound sales automation for B2B SaaS",
      oneLiner: "AI SDR for early-stage GTM teams",
      stage: "Series B",
      industry: "Sales Tech",
      isHiring: true,
    },
    dossier: {
      summary:
        "Pipeline automates outbound sales motions for early-stage B2B teams — sequence orchestration, reply detection, and pipeline reporting in one workspace.",
      surfaces: [
        "AI sequence generation",
        "reply-rate dashboard",
        "pipeline forecasting reports",
      ],
      recentLaunches: [
        "shipped Salesforce two-way sync",
        "launched RevenueOS — pipeline forecast bundled with deal scoring",
      ],
      technicalAreas: ["CRM integrations", "deliverability heuristics"],
    },
  },
];

// Mirrors the production resumeBulletInstructionFor() in sender-profile.ts.
// Duplicated here (rather than imported) because that file's primary export
// (buildSenderContextFromProfile) is wired to a ResolvedProfile shape that
// requires a Supabase round-trip; for a smoke we just want the string.
// Keep this in sync with sender-profile.ts:ROLE_BULLET_HINTS — drift here
// will silently produce smoke results that don't reflect production.
const ROLE_BULLET_HINTS: Record<RoleFamily, string> = {
  engineering:
    "If the resume includes engineering work (systems, infrastructure, code, models, developer tools, shipping at scale), prefer that bullet.",
  product:
    "If the resume includes product or design work (user-facing features, decisions, research, craft), prefer that bullet.",
  gtm:
    "If the resume includes go-to-market work (sales, marketing, growth, revenue, partnerships, customer wins), prefer that bullet.",
  operations:
    "If the resume includes operations, finance, people, or process work (scaling teams, hiring, systems, cross-functional execution), prefer that bullet.",
};

function senderContextFor(role: RoleFamily): string {
  const bullet = `Use one relevant detail from the sender's resume only if it strengthens the email. Make it specific and natural; do not list multiple bullets or invent experience. ${ROLE_BULLET_HINTS[role]}`;
  return buildSenderContext({
    name: SENDER_NAME,
    bio: bullet,
    resumeText: RESUME,
  });
}

interface DraftOutcome {
  role: RoleFamily;
  fitAngle: string | null;
  featureLine: string | null;
  subject: string;
  body: string;
}

async function runFixture(fixture: Fixture): Promise<DraftOutcome[]> {
  const outcomes: DraftOutcome[] = [];
  for (const family of ROLE_FAMILIES) {
    const role = family.id;
    const pick = await pickFitAngle({
      dossier: fixture.dossier,
      resumeText: RESUME,
      apiKey: apiKey!,
      targetRole: role,
    });
    const draft = await generateEmailDraft({
      kind: "ai",
      contact: CONTACT,
      company: fixture.company,
      interestHook: null,
      senderContext: senderContextFor(role),
      apiKey: apiKey!,
      subjectTemplate: null,
      senderName: SENDER_NAME,
      featureLine: pick.featureLine,
      fitAngle: pick.fitAngle,
      targetRole: role,
    });
    outcomes.push({
      role,
      fitAngle: pick.fitAngle,
      featureLine: pick.featureLine,
      subject: draft.subject,
      body: draft.body,
    });
  }
  return outcomes;
}

function formatFixture(fixture: Fixture, outcomes: DraftOutcome[]): string {
  const lines: string[] = [];
  lines.push(`## ${fixture.company.name} — ${fixture.label}`);
  lines.push("");
  lines.push(`- domain: ${fixture.company.domain}`);
  lines.push(`- stage: ${fixture.company.stage}`);
  lines.push(`- one-liner: ${fixture.company.oneLiner}`);
  lines.push(`- dossier surfaces: ${fixture.dossier.surfaces.join("; ")}`);
  lines.push("");
  for (const o of outcomes) {
    lines.push(`### role: ${o.role}`);
    lines.push("");
    lines.push(`- featureLine: ${o.featureLine ?? "(none)"}`);
    lines.push(`- fitAngle: ${o.fitAngle ?? "(none)"}`);
    lines.push(`- subject: ${o.subject}`);
    lines.push("");
    lines.push("```");
    lines.push(o.body);
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  console.log(`Smoke — per-role draft variants`);
  console.log(`Resume: cross-functional (eng + product + gtm + ops bullets)`);
  console.log(`Contact: ${CONTACT.name}, ${CONTACT.title}`);
  console.log(`Fixtures: ${FIXTURES.length} × Roles: ${ROLE_FAMILIES.length} = ${FIXTURES.length * ROLE_FAMILIES.length} drafts`);
  console.log("");

  const sections: string[] = [];
  for (const fixture of FIXTURES) {
    console.log(`> ${fixture.company.name} (${fixture.label})`);
    const t0 = Date.now();
    const outcomes = await runFixture(fixture);
    console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const section = formatFixture(fixture, outcomes);
    sections.push(section);
    console.log("");
    console.log(section);
    console.log("");
  }

  if (SHOULD_WRITE) {
    const md = [
      `# Per-role draft smoke — ${new Date().toISOString()}`,
      "",
      `Resume held constant (cross-functional). Contact held constant. Varied only \`targetRole\` across the 4 families.`,
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
