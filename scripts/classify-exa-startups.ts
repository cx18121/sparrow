import "dotenv/config";
import { prisma } from "./_lib/prisma.js";
import { callClaude } from "../server/lib/ai/anthropic.js";

// Phase 2 of exa-discovery quality cleanup.
//
// Phase 1 (demote-exa-junk.ts) handled the obvious non-startups by regex.
// This script asks Haiku 4.5 to classify the remaining survivors as
// VC-backable product startups or not, and demotes the "no" verdicts.
//
// Usage:
//   npx tsx scripts/classify-exa-startups.ts                 # dry, limit 100
//   npx tsx scripts/classify-exa-startups.ts --limit 500     # bigger dry sample
//   npx tsx scripts/classify-exa-startups.ts --apply         # write demotions
//   npx tsx scripts/classify-exa-startups.ts --apply --all   # process every row
//
// Idempotent: tags `exa-llm-tried` on every processed row so re-runs skip
// previously classified rows. Demoted rows additionally get `exa-junk-llm`.
//
// Cost shape: ~20 rows per Haiku call, ~1k batches for 20k rows → ~$3.

const MODEL = "claude-haiku-4-5-20251001";
const BATCH_SIZE = 20;
const CONCURRENCY = 8;

const SYSTEM_PROMPT = `You classify companies as VC-backable product startups (YES), not VC-backable (NO), or ambiguous (UNSURE).

VC-backable PRODUCT STARTUP (yes):
- Ships software, hardware, biotech, or other product
- Has growth ambition (not a lifestyle business)
- Plausibly raises or has raised VC

NOT VC-backable (no):
- Consulting / advisory / services-only firms
- VC funds, accelerators, incubators, venture studios, family offices
- Non-profits, NGOs, foundations, charities, religious organizations
- Government agencies, public-sector entities
- Media outlets, blogs, news sites, magazines
- Personal portfolios, individual coaches, freelancers
- Bootstrapped lifestyle businesses, marketing agencies, design agencies
- Acquired or dead companies with no current product
- Universities, research institutes, professional associations

When uncertain, output "unsure" — we re-verify those manually. Be especially careful with names like "Foo Labs" (could be a real product startup OR a venture studio).

OUTPUT FORMAT — one line per company, exactly:
<id>|<yes|no|unsure>|<reason in 6 words or fewer>

No extra prose. No header. No numbering. Just one line per company in order.`;

interface Row { id: string; name: string; domain: string | null; description: string | null; }
interface Verdict { id: string; verdict: "yes" | "no" | "unsure"; reason: string; }

function buildUserMessage(rows: Row[]): string {
  return rows.map((r) => {
    const desc = (r.description ?? "").slice(0, 300).replace(/\s+/g, " ").trim();
    return `id=${r.id} name="${r.name.replace(/"/g, "'")}" domain=${r.domain ?? "-"} desc="${desc}"`;
  }).join("\n");
}

function parseVerdicts(text: string, expectedIds: string[]): Verdict[] {
  const out: Verdict[] = [];
  const expectedSet = new Set(expectedIds);
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([a-z0-9]+)\|(yes|no|unsure)\|(.{1,80})$/i);
    if (!m) continue;
    const id = m[1];
    if (!expectedSet.has(id)) continue;
    out.push({ id, verdict: m[2].toLowerCase() as Verdict["verdict"], reason: m[3].trim() });
  }
  return out;
}

async function classifyBatch(rows: Row[], apiKey: string): Promise<Verdict[]> {
  const userContent = buildUserMessage(rows);
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = await callClaude({
        apiKey,
        model: MODEL,
        system: SYSTEM_PROMPT,
        userContent,
        maxTokens: 1200,
      });
      const verdicts = parseVerdicts(text, rows.map((r) => r.id));
      if (verdicts.length >= rows.length * 0.75) return verdicts;
      lastErr = new Error(`Got ${verdicts.length}/${rows.length} verdicts`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  console.error(`  batch failed after retries: ${lastErr}`);
  return [];
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const all = argv.includes("--all");
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx !== -1 ? parseInt(argv[limitIdx + 1], 10) : (all ? 0 : 100);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");

  const rows = await prisma.company.findMany({
    where: {
      source: "exa-discovery",
      isVerified: true,
      NOT: { tags: { hasSome: ["exa-junk-regex", "exa-llm-tried"] } },
    },
    select: { id: true, name: true, domain: true, description: true },
    ...(limit > 0 ? { take: limit } : {}),
  });
  console.log(`Classifying ${rows.length} rows in batches of ${BATCH_SIZE} (apply=${apply})`);

  const batches: Row[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) batches.push(rows.slice(i, i + BATCH_SIZE));

  const allVerdicts: Verdict[] = [];
  let done = 0;
  let inFlight = 0;
  let next = 0;

  await new Promise<void>((resolve) => {
    const launch = () => {
      while (inFlight < CONCURRENCY && next < batches.length) {
        const idx = next++;
        inFlight++;
        classifyBatch(batches[idx], apiKey).then((v) => {
          allVerdicts.push(...v);
          done++;
          inFlight--;
          if (done % 10 === 0 || done === batches.length) {
            console.log(`  ${done}/${batches.length} batches`);
          }
          if (done === batches.length) resolve();
          else launch();
        });
      }
    };
    launch();
  });

  const counts = { yes: 0, no: 0, unsure: 0 };
  for (const v of allVerdicts) counts[v.verdict]++;
  console.log(`\nTotal verdicts: ${allVerdicts.length} of ${rows.length} rows`);
  console.log(`  yes:    ${counts.yes}`);
  console.log(`  no:     ${counts.no}`);
  console.log(`  unsure: ${counts.unsure}`);

  // Show 15 samples per verdict so user can spot-check
  for (const k of ["yes", "no", "unsure"] as const) {
    const sample = allVerdicts.filter((v) => v.verdict === k).slice().sort(() => Math.random() - 0.5).slice(0, 15);
    const idLookup = new Map(rows.map((r) => [r.id, r]));
    console.log(`\nSample of '${k}':`);
    for (const v of sample) {
      const r = idLookup.get(v.id);
      console.log(`  [${v.verdict}] ${r?.name ?? "?"} (${r?.domain ?? "-"}) → ${v.reason}`);
    }
  }

  if (!apply) {
    console.log("\nDRY mode — no writes. Re-run with --apply.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nWriting tags...`);
  let written = 0;
  for (const v of allVerdicts) {
    const tagsToAdd = ["exa-llm-tried"];
    if (v.verdict === "no") tagsToAdd.push("exa-junk-llm");
    await prisma.company.update({
      where: { id: v.id },
      data: {
        ...(v.verdict === "no" ? { isVerified: false } : {}),
        tags: { push: tagsToAdd },
      },
    });
    written++;
    if (written % 500 === 0) console.log(`  ${written}/${allVerdicts.length}`);
  }
  console.log(`Done. ${written} rows tagged. ${counts.no} demoted.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
