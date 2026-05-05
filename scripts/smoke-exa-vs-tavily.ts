import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { prisma } from "./_lib/prisma.js";
import { exaSearch } from "../server/lib/ai/exa-search.js";
import { tavilySearch } from "../server/lib/ai/tavily-search.js";
import {
  researchCompanyDossier,
  researchCompanyDossierExa,
  pickFitAngle,
  type CompanyDossier,
} from "../server/lib/ai/research-fit-angle.js";

// Side-by-side eval: same company, same synthesis prompt, same fit-angle prompt
// — only the retrieval provider differs (Tavily vs Exa). Isolates retrieval
// quality as the variable so we can measure whether Exa's date filtering +
// neural routing actually produces a richer dossier than Tavily's keyword
// pull on the kinds of small/recent companies our DB is full of.
//
// What it prints (per company):
//   1. Apollo context (name, oneLiner, industry, domain)
//   2. Tavily: query → top results (title + url) → dossier JSON → fit angle
//   3. Exa:    query → top results (title + url + publishedDate) → dossier JSON → fit angle
//
// Optionally writes the same content as Markdown to .scratch/exa-eval.md
// for manual rating. Use --eval to enable.
//
// Usage:
//   npx tsx scripts/smoke-exa-vs-tavily.ts --domain anthropic.com
//   npx tsx scripts/smoke-exa-vs-tavily.ts --company-id <cuid>
//   npx tsx scripts/smoke-exa-vs-tavily.ts --limit 5             # 5 random verified
//   npx tsx scripts/smoke-exa-vs-tavily.ts --limit 10 --eval     # write .scratch/exa-eval.md
//   npx tsx scripts/smoke-exa-vs-tavily.ts --limit 5 --recency 90

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
const tavilyKey = process.env.TAVILY_API_KEY?.trim();
const exaKey = process.env.EXA_API_KEY?.trim();

if (!apiKey) {
  console.error("ANTHROPIC_API_KEY missing.");
  process.exit(1);
}
if (!tavilyKey) {
  console.error("TAVILY_API_KEY missing — needed for the A/B baseline.");
  process.exit(1);
}
if (!exaKey) {
  console.error("EXA_API_KEY missing.");
  process.exit(1);
}

async function loadCompanies(): Promise<CompanyRow[]> {
  const domain = parseFlag("--domain");
  const id = parseFlag("--company-id");
  const limit = parseInt(parseFlag("--limit") ?? "1", 10);

  if (id) {
    const c = await prisma.company.findUnique({
      where: { id },
      select: {
        id: true, name: true, domain: true, oneLiner: true,
        description: true, industry: true, stage: true, isHiring: true,
      },
    });
    if (!c) throw new Error(`No company with id=${id}`);
    return [c];
  }

  if (domain) {
    const c = await prisma.company.findFirst({
      where: { domain },
      select: {
        id: true, name: true, domain: true, oneLiner: true,
        description: true, industry: true, stage: true, isHiring: true,
      },
    });
    // Fall back to a synthetic row so smoke runs work for arbitrary domains
    // not yet in the DB — useful for live demos where we want to point at
    // any company on the fly.
    if (!c) {
      return [{
        id: "(not-in-db)",
        name: domain.split(".")[0],
        domain,
        oneLiner: null,
        description: null,
        industry: null,
        stage: null,
        isHiring: false,
      }];
    }
    return [c];
  }

  // Random sample of verified companies. Random offset is cheaper than
  // ORDER BY RANDOM() at scale and fine for N≤20.
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
      skip: off,
      take: 1,
      orderBy: { id: "asc" },
    });
    if (c) rows.push(c);
  }
  return rows;
}

interface ProviderRun {
  provider: "tavily" | "exa";
  query: string;
  results: { title: string; url: string; publishedDate?: string | null }[];
  dossier: CompanyDossier;
  fit: { featureLine: string | null; fitAngle: string | null };
  ms: number;
}

function buildQuery(c: CompanyRow): string {
  // Match the production buildSearchQuery in research-fit-angle.ts so neither
  // provider gets an unfair query advantage.
  return `${c.name} ${c.domain} product features recent launches`;
}

async function runTavily(c: CompanyRow): Promise<ProviderRun> {
  const t0 = Date.now();
  const query = buildQuery(c);
  // Surface the raw retrieval results separately from the dossier so we can
  // see WHAT Tavily returned, not just what Claude synthesized from it.
  const raw = await tavilySearch({ query, apiKey: tavilyKey!, maxResults: 5, searchDepth: "advanced" });
  const dossier = await researchCompanyDossier({
    company: { ...c, domain: c.domain },
    apiKey: apiKey!,
    tavilyApiKey: tavilyKey!,
  });
  const fit = await pickFitAngle({ dossier, resumeText: RESUME, apiKey: apiKey! });
  return {
    provider: "tavily",
    query,
    results: raw.results.map(r => ({ title: r.title, url: r.url })),
    dossier,
    fit,
    ms: Date.now() - t0,
  };
}

async function runExa(c: CompanyRow, recencyDays: number): Promise<ProviderRun> {
  const t0 = Date.now();
  const query = buildQuery(c);
  const startDate = new Date(Date.now() - recencyDays * 24 * 60 * 60 * 1000).toISOString();
  const raw = await exaSearch({
    query,
    apiKey: exaKey!,
    numResults: 5,
    type: "auto",
    startPublishedDate: startDate,
    textMaxCharacters: 2000,
  });
  const dossier = await researchCompanyDossierExa({
    company: { ...c, domain: c.domain },
    apiKey: apiKey!,
    exaApiKey: exaKey!,
    recencyDays,
  });
  const fit = await pickFitAngle({ dossier, resumeText: RESUME, apiKey: apiKey! });
  return {
    provider: "exa",
    query,
    results: raw.results.map(r => ({ title: r.title, url: r.url, publishedDate: r.publishedDate })),
    dossier,
    fit,
    ms: Date.now() - t0,
  };
}

function printRun(label: string, run: ProviderRun) {
  console.log(`\n--- ${label} (${run.ms}ms) ---`);
  console.log(`query: ${run.query}`);
  console.log("top results:");
  if (run.results.length === 0) {
    console.log("  (none)");
  } else {
    for (let i = 0; i < run.results.length; i++) {
      const r = run.results[i];
      const date = r.publishedDate ? ` [${r.publishedDate.slice(0, 10)}]` : "";
      console.log(`  ${i + 1}. ${r.title}${date}`);
      console.log(`     ${r.url}`);
    }
  }
  console.log("dossier:");
  console.log(`  summary:        ${run.dossier.summary || "(empty)"}`);
  console.log(`  surfaces:       ${run.dossier.surfaces.join(", ") || "(none)"}`);
  console.log(`  recentLaunches: ${run.dossier.recentLaunches.join(", ") || "(none)"}`);
  console.log(`  technicalAreas: ${run.dossier.technicalAreas.join(", ") || "(none)"}`);
  console.log("fit angle:");
  console.log(`  featureLine: ${run.fit.featureLine ?? "<NONE>"}`);
  console.log(`  fitAngle:    ${run.fit.fitAngle ?? "<NONE>"}`);
}

function toMarkdown(c: CompanyRow, tav: ProviderRun, exa: ProviderRun): string {
  const lines: string[] = [];
  lines.push(`## ${c.name} (${c.domain})`);
  lines.push("");
  if (c.oneLiner) lines.push(`> ${c.oneLiner}`);
  lines.push(`- industry: \`${c.industry ?? "—"}\` | stage: \`${c.stage ?? "—"}\` | hiring: \`${c.isHiring}\``);
  lines.push("");
  for (const run of [tav, exa]) {
    lines.push(`### ${run.provider.toUpperCase()} (${run.ms}ms)`);
    lines.push("");
    lines.push(`**query:** \`${run.query}\``);
    lines.push("");
    lines.push("**top results:**");
    if (run.results.length === 0) {
      lines.push("- (none)");
    } else {
      for (const r of run.results) {
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
    lines.push(`**fit angle:** featureLine=\`${run.fit.featureLine ?? "NONE"}\` | fitAngle=\`${run.fit.fitAngle ?? "NONE"}\``);
    lines.push("");
  }
  lines.push("**Manual rating** (fill in during eval):");
  lines.push("- specificity (1–5): tavily=__ exa=__");
  lines.push("- recency (1–5): tavily=__ exa=__");
  lines.push("- would email this? (y/n): tavily=__ exa=__");
  lines.push("- notes: ");
  lines.push("");
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const recencyDays = parseInt(parseFlag("--recency") ?? "180", 10);
  const writeEval = hasFlag("--eval");
  const evalPath = ".scratch/exa-eval.md";

  const companies = await loadCompanies();
  console.log(`Running A/B on ${companies.length} compan${companies.length === 1 ? "y" : "ies"}.\n`);

  const mdSections: string[] = [];
  if (writeEval) {
    mdSections.push(`# Exa vs Tavily — retrieval A/B\n`);
    mdSections.push(`_Generated ${new Date().toISOString()} | recency window: ${recencyDays}d | resume: Cornell eval/RAG_\n`);
    mdSections.push(`Same synthesis prompt, same fit-angle prompt, same resume across both providers — only retrieval differs.\n`);
    mdSections.push(`---\n`);
  }

  for (const c of companies) {
    console.log("=".repeat(72));
    console.log(`COMPANY: ${c.name} (${c.domain})`);
    console.log(`  oneLiner: ${c.oneLiner ?? "(none)"}`);
    console.log(`  industry: ${c.industry ?? "(none)"} | stage: ${c.stage ?? "(none)"} | hiring: ${c.isHiring}`);

    let tav: ProviderRun;
    let exa: ProviderRun;
    try {
      // Run sequentially rather than in parallel — Anthropic shares a rate
      // pool across both calls, and parallel runs occasionally trip 429s
      // on this account. Sequential is also more honest for per-call timing.
      tav = await runTavily(c);
      exa = await runExa(c, recencyDays);
    } catch (err) {
      console.error(`  failed: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    printRun("TAVILY (no recency filter)", tav);
    printRun(`EXA (recency ${recencyDays}d, type=auto)`, exa);

    if (writeEval) {
      mdSections.push(toMarkdown(c, tav, exa));
    }
  }

  if (writeEval) {
    await mkdir(dirname(evalPath), { recursive: true }).catch(() => {});
    await writeFile(evalPath, mdSections.join("\n"));
    console.log(`\nWrote eval log → ${evalPath}`);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Demo failed:", err);
  process.exit(1);
});
