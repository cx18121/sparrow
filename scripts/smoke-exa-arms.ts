import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { prisma } from "./_lib/prisma.js";
import { exaSearch, exaContents, type ExaResult } from "../server/lib/ai/exa-search.js";
import {
  synthesizeDossier,
  pickFitAngle,
  type CompanyDossier,
} from "../server/lib/ai/research-fit-angle.js";

// Three-arm A/B/C eval for Exa retrieval shapes:
//   A. /search only            (current production behavior)
//   B. /contents only          (company self-narrative — homepage + subpages)
//   C. layered: /search + /contents merged, deduped by URL
//
// Same synthesis prompt and same fit-angle pass across all three so the only
// confound is what we put in the result list. Prints all three dossiers
// per company and writes the same to .scratch/exa-arms-eval.md.
//
// Usage:
//   npx tsx scripts/smoke-exa-arms.ts --limit 10
//   npx tsx scripts/smoke-exa-arms.ts --domain anthropic.com
//   npx tsx scripts/smoke-exa-arms.ts --limit 10 --no-md   # console only

interface CompanyRow {
  id: string;
  name: string;
  domain: string;
  oneLiner: string | null;
  description: string | null;
  industry: string | null;
  stage: string | null;
  isHiring: boolean;
}

function parseFlag(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

const RESUME = `
Charles Xue — CS & Statistics @ Cornell University.

Projects:
- Multi-agent eval harness: built a deterministic replay tool for cross-model
  agent benchmarks; reduced flaky scores by 60% by pinning seed + tool order.
- RAG eval pipeline: shipped retrieval + answer-faithfulness scoring across 6
  internal LLM clients; cut hallucination rate 38% by hybrid HNSW + lexical.
- Cold-email automation: built a per-recipient personalization pipeline using
  retrieval-augmented context; isolated retrieval as the quality bottleneck
  via A/B between Tavily and Exa on real DB rows.
`.trim();

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
const exaKey = process.env.EXA_API_KEY?.trim();

if (!apiKey) { console.error("ANTHROPIC_API_KEY missing."); process.exit(1); }
if (!exaKey) { console.error("EXA_API_KEY missing."); process.exit(1); }

async function loadCompanies(): Promise<CompanyRow[]> {
  const domain = parseFlag("--domain");
  const limit = parseInt(parseFlag("--limit") ?? "5", 10);

  if (domain) {
    const c = await prisma.company.findFirst({
      where: { domain },
      select: {
        id: true, name: true, domain: true, oneLiner: true,
        description: true, industry: true, stage: true, isHiring: true,
      },
    });
    if (!c) {
      return [{
        id: "(not-in-db)", name: domain.split(".")[0], domain,
        oneLiner: null, description: null, industry: null, stage: null, isHiring: false,
      }];
    }
    return [c];
  }

  const total = await prisma.company.count({ where: { isVerified: true } });
  const offsets = Array.from({ length: limit }, () =>
    Math.floor(Math.random() * Math.max(0, total - 1))
  );
  const rows: CompanyRow[] = [];
  for (const off of offsets) {
    const [c] = await prisma.company.findMany({
      where: { isVerified: true },
      select: {
        id: true, name: true, domain: true, oneLiner: true,
        description: true, industry: true, stage: true, isHiring: true,
      },
      skip: off, take: 1, orderBy: { id: "asc" },
    });
    if (c) rows.push(c);
  }
  return rows;
}

interface ArmRun {
  arm: "A-search" | "B-contents" | "C-layered";
  rawResults: { title: string; url: string; publishedDate?: string | null }[];
  dossier: CompanyDossier;
  fit: { featureLine: string | null; fitAngle: string | null };
  ms: number;
}

function buildSearchQuery(c: CompanyRow): string {
  return `${c.name} ${c.domain} product features recent launches`;
}

// Dedupe by URL (case-insensitive on host), keeping the first occurrence.
function dedupeByUrl(items: ExaResult[]): ExaResult[] {
  const seen = new Set<string>();
  const out: ExaResult[] = [];
  for (const r of items) {
    const key = r.url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function runSearchArm(c: CompanyRow): Promise<ArmRun> {
  const t0 = Date.now();
  const startDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const search = await exaSearch({
    query: buildSearchQuery(c),
    apiKey: exaKey!,
    numResults: 5,
    type: "auto",
    startPublishedDate: startDate,
    textMaxCharacters: 2000,
  });
  const dossier = await synthesizeDossier(c, search.results, apiKey!);
  const fit = await pickFitAngle({ dossier, resumeText: RESUME, apiKey: apiKey! });
  return {
    arm: "A-search",
    rawResults: search.results.map(r => ({ title: r.title, url: r.url, publishedDate: r.publishedDate })),
    dossier, fit, ms: Date.now() - t0,
  };
}

async function runContentsArm(c: CompanyRow): Promise<ArmRun> {
  const t0 = Date.now();
  const url = c.domain.startsWith("http") ? c.domain : `https://${c.domain}`;
  const contents = await exaContents({
    urls: [url],
    apiKey: exaKey!,
    subpageTarget: ["about", "team", "careers", "blog", "product"],
    subpages: 5,
    livecrawl: "auto",
    textMaxCharacters: 2000,
  });
  const dossier = await synthesizeDossier(c, contents.results, apiKey!);
  const fit = await pickFitAngle({ dossier, resumeText: RESUME, apiKey: apiKey! });
  return {
    arm: "B-contents",
    rawResults: contents.results.map(r => ({ title: r.title, url: r.url, publishedDate: r.publishedDate })),
    dossier, fit, ms: Date.now() - t0,
  };
}

async function runLayeredArm(c: CompanyRow): Promise<ArmRun> {
  const t0 = Date.now();
  const startDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const url = c.domain.startsWith("http") ? c.domain : `https://${c.domain}`;
  // Run both retrieval calls in parallel — they're independent.
  const [search, contents] = await Promise.all([
    exaSearch({
      query: buildSearchQuery(c),
      apiKey: exaKey!,
      numResults: 5, type: "auto",
      startPublishedDate: startDate,
      textMaxCharacters: 2000,
    }),
    exaContents({
      urls: [url],
      apiKey: exaKey!,
      subpageTarget: ["about", "team", "careers", "blog", "product"],
      subpages: 5,
      livecrawl: "auto",
      textMaxCharacters: 2000,
    }),
  ]);
  // Merge: contents first (company self-narrative anchors the dossier), then
  // search (third-party news layered on top). Dedupe by URL.
  const merged = dedupeByUrl([...contents.results, ...search.results]);
  const dossier = await synthesizeDossier(c, merged, apiKey!);
  const fit = await pickFitAngle({ dossier, resumeText: RESUME, apiKey: apiKey! });
  return {
    arm: "C-layered",
    rawResults: merged.map(r => ({ title: r.title, url: r.url, publishedDate: r.publishedDate })),
    dossier, fit, ms: Date.now() - t0,
  };
}

function printArm(run: ArmRun) {
  console.log(`\n--- ${run.arm} (${run.ms}ms, ${run.rawResults.length} sources) ---`);
  for (let i = 0; i < run.rawResults.length; i++) {
    const r = run.rawResults[i];
    const date = r.publishedDate ? ` [${r.publishedDate.slice(0, 10)}]` : "";
    console.log(`  ${i + 1}. ${r.title}${date}`);
    console.log(`     ${r.url}`);
  }
  console.log("dossier:");
  console.log(`  summary:        ${run.dossier.summary || "(empty)"}`);
  console.log(`  surfaces:       ${run.dossier.surfaces.join(", ") || "(none)"}`);
  console.log(`  recentLaunches: ${run.dossier.recentLaunches.join(", ") || "(none)"}`);
  console.log(`  technicalAreas: ${run.dossier.technicalAreas.join(", ") || "(none)"}`);
  console.log(`fit: featureLine="${run.fit.featureLine ?? "NONE"}" | fitAngle="${run.fit.fitAngle ?? "NONE"}"`);
}

function toMarkdown(c: CompanyRow, runs: ArmRun[]): string {
  const lines: string[] = [];
  lines.push(`## ${c.name} (${c.domain})`);
  lines.push("");
  if (c.oneLiner) lines.push(`> ${c.oneLiner}`);
  lines.push(`- industry: \`${c.industry ?? "—"}\` | stage: \`${c.stage ?? "—"}\` | hiring: \`${c.isHiring}\``);
  lines.push("");
  for (const run of runs) {
    lines.push(`### ${run.arm} (${run.ms}ms, ${run.rawResults.length} sources)`);
    lines.push("");
    lines.push("**sources:**");
    if (run.rawResults.length === 0) {
      lines.push("- (none)");
    } else {
      for (const r of run.rawResults) {
        const date = r.publishedDate ? ` _(${r.publishedDate.slice(0, 10)})_` : "";
        lines.push(`- [${r.title}](${r.url})${date}`);
      }
    }
    lines.push("");
    lines.push("**dossier:**");
    lines.push(`- summary: ${run.dossier.summary || "_(empty)_"}`);
    lines.push(`- surfaces: ${run.dossier.surfaces.join(", ") || "_(none)_"}`);
    lines.push(`- recentLaunches: ${run.dossier.recentLaunches.join(", ") || "_(none)_"}`);
    lines.push(`- technicalAreas: ${run.dossier.technicalAreas.join(", ") || "_(none)_"}`);
    lines.push("");
    lines.push(`**fit:** featureLine=\`${run.fit.featureLine ?? "NONE"}\` | fitAngle=\`${run.fit.fitAngle ?? "NONE"}\``);
    lines.push("");
  }
  lines.push("**Manual rating:**");
  lines.push("- specificity (1–5): A=__ B=__ C=__");
  lines.push("- recency (1–5): A=__ B=__ C=__");
  lines.push("- best arm: __");
  lines.push("- notes: ");
  lines.push("");
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const writeMd = !hasFlag("--no-md");
  const evalPath = ".scratch/exa-arms-eval.md";

  const companies = await loadCompanies();
  console.log(`Running 3-arm eval on ${companies.length} compan${companies.length === 1 ? "y" : "ies"}.\n`);

  const mdSections: string[] = [];
  if (writeMd) {
    mdSections.push(`# Exa retrieval shapes — A/B/C\n`);
    mdSections.push(`_Generated ${new Date().toISOString()}_\n`);
    mdSections.push(`- **Arm A** — \`/search\` only (current production)`);
    mdSections.push(`- **Arm B** — \`/contents\` only (company self-narrative + subpages)`);
    mdSections.push(`- **Arm C** — layered: \`/contents\` + \`/search\`, deduped by URL`);
    mdSections.push("");
    mdSections.push(`Same synthesis prompt + same resume across all three. Only the result list differs.`);
    mdSections.push("");
    mdSections.push("---\n");
  }

  for (const c of companies) {
    console.log("=".repeat(72));
    console.log(`COMPANY: ${c.name} (${c.domain})`);
    console.log(`  oneLiner: ${c.oneLiner ?? "(none)"}`);
    console.log(`  industry: ${c.industry ?? "(none)"} | stage: ${c.stage ?? "(none)"} | hiring: ${c.isHiring}`);

    const runs: ArmRun[] = [];
    try {
      // Run arms sequentially — Anthropic shares a rate pool across them and
      // parallel runs occasionally trip 429s. Inside each arm the two Exa
      // calls (for arm C) still go in parallel.
      runs.push(await runSearchArm(c));
      runs.push(await runContentsArm(c));
      runs.push(await runLayeredArm(c));
    } catch (err) {
      console.error(`  failed: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    for (const r of runs) printArm(r);
    if (writeMd) mdSections.push(toMarkdown(c, runs));
  }

  if (writeMd) {
    await mkdir(dirname(evalPath), { recursive: true }).catch(() => {});
    await writeFile(evalPath, mdSections.join("\n"));
    console.log(`\nWrote eval log → ${evalPath}`);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Eval failed:", err);
  process.exit(1);
});
