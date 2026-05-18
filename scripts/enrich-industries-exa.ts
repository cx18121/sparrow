import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { mergeTags, tagFromTopic } from "./_lib/tags.js";
import { exaSearch, type ExaResult } from "../server/lib/ai/exa-search.js";
import { callClaude } from "../server/lib/ai/anthropic.js";

// Exa-grounded industry enrichment for rows the description-only LLM pass
// (enrich-industries-llm.ts) can't classify because the row has no
// description/oneLiner to work from. Common for the newer VC adapters
// (Insight, Lightspeed, Redpoint, General Catalyst, etc.) whose portfolio
// sites publish just {name, website}.
//
// Pipeline (per company):
//   1. Exa /search on `"<Name>" <domain> company` to pull a few snippets
//      describing what the company does. No recency filter — we want the
//      most authoritative description, which usually lives on a static
//      "about" page or a Wikipedia/Crunchbase aggregator.
//   2. Synthesize a 1-2 sentence description from snippets via Haiku.
//   3. Persist description ONLY if at least one Exa result URL hostname
//      matches the company's own domain — strong signal that snippets are
//      about THIS company and not a same-named entity. Company.description
//      is user-facing (rendered in lead browsing), so a wrong-entity write
//      would mislead users. Industry still writes on weaker signal because
//      the closed vocab + Unknown fallback are self-limiting (model can
//      just say Unknown if uncertain).
//   4. Classify into the same closed industry vocab as the LLM pass. Same
//      vocab → same downstream tag mapping, so wizard filters surface
//      these rows identically to other sources.
//   5. Tag row with `exa-industry-tried` (always, even on whiff) as the
//      one-shot guard. `exa-industry-enriched` only on hit.
//
// Cost (rough): ~$0.005 per row (1 Exa search + 1 Haiku call). For ~2,500
// rows that's ~$13. Idempotent via tag guard.
//
// Usage:
//   npx tsx scripts/enrich-industries-exa.ts --limit 20 --dry-run
//   npx tsx scripts/enrich-industries-exa.ts --limit 100
//   npx tsx scripts/enrich-industries-exa.ts                  # full pass
//   npx tsx scripts/enrich-industries-exa.ts --concurrency 4

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_EXA_RESULTS = 4;
const PER_RESULT_CHARS = 1200;

// Mirror the vocab from enrich-industries-llm.ts so downstream tagFromTopic
// mapping is identical. Adding values would write industries that don't map
// to a tag — defeats the purpose.
const VOCAB = [
  "fintech", "health", "biotech", "education", "legal", "real estate",
  "govtech", "agriculture", "climate", "energy", "industrial", "logistics",
  "ecommerce", "gaming", "sports", "travel", "food", "fashion", "beauty",
  "pets", "parenting", "dating", "automotive",
  "ai", "crypto", "devtools", "devops", "infrastructure", "security",
  "data", "analytics", "nocode", "api", "web", "mobile", "iot", "xr",
  "hardware", "robotics", "automation",
  "saas", "marketplace", "consumer", "b2b",
  "marketing", "sales", "hr", "productivity", "design", "content",
  "communication", "search",
  "video", "audio", "music", "podcast", "photo",
  "social", "community",
];
const VOCAB_SET = new Set(VOCAB);

const LLM_SYSTEM = `You analyze company web search snippets and return strict JSON with this exact shape:

{"description": "<1-2 sentence neutral description of what the company does, max 200 chars>", "industry": "<one of: ${VOCAB.join(" | ")} | Unknown>"}

Rules:
- description: factual, no marketing fluff. If snippets don't clearly describe a company (e.g., they're about a different entity with the same name, or just contain navigation text), return null.
- industry: pick the single best fit. If torn between vertical and tech, pick the vertical (e.g., "fintech" wins over "ai" for an AI banking startup). If snippets are too thin to tell, return "Unknown".
- Output JSON only — no markdown, no commentary.`;

function parseFlag(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}
function parseInt10(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

interface CompanyRow {
  id: string;
  name: string;
  domain: string;
  tags: string[];
}

interface Stats {
  scanned: number;
  exaEmpty: number;
  exaErrors: number;
  llmCalls: number;
  llmErrors: number;
  descriptionsWritten: number;
  descriptionsSkippedNoDomain: number;
  industriesClassified: number;
  unknownFromModel: number;
  invalidVocab: number;
  tagAdditions: number;
  writes: number;
}

function buildExaQuery(c: CompanyRow): string {
  // Quoted name pins the entity; domain disambiguates common-word names;
  // "company" hints at the "about the company" type page we want.
  return `"${c.name}" ${c.domain} company`;
}

function blobFromExa(results: ExaResult[]): string {
  return results
    .map(r => `${r.title}\n${r.content.slice(0, PER_RESULT_CHARS)}`)
    .join("\n\n");
}

// Returns true when at least one result URL's hostname matches (or is a
// subdomain of) the company's own domain. Confidence guard for writing
// LLM-synthesized text to the user-facing description field.
function resultsContainOwnDomain(results: ExaResult[], domain: string): boolean {
  if (!domain) return false;
  const target = domain.toLowerCase().replace(/^www\./, "");
  for (const r of results) {
    try {
      const host = new URL(r.url).hostname.toLowerCase().replace(/^www\./, "");
      if (host === target || host.endsWith(`.${target}`)) return true;
    } catch {
      // ignore malformed URLs
    }
  }
  return false;
}

function safeJsonParse(text: string): { description?: unknown; industry?: unknown } | null {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/g, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function llmExtract(
  apiKey: string,
  blob: string,
  companyName: string
): Promise<{ description: string | null; industry: string | null }> {
  const reply = await callClaude({
    apiKey,
    model: MODEL,
    system: LLM_SYSTEM,
    userContent: `Company name: ${companyName}\n\nSearch snippets:\n${blob.slice(0, 6000)}`,
    maxTokens: 300,
  });
  const parsed = safeJsonParse(reply);
  if (!parsed) return { description: null, industry: null };

  const description = typeof parsed.description === "string" && parsed.description.length >= 10
    ? parsed.description.trim().slice(0, 300)
    : null;
  const industry = typeof parsed.industry === "string" ? parsed.industry.trim() : null;
  return { description, industry };
}

async function processOne(
  row: CompanyRow,
  exaKey: string,
  apiKey: string,
  stats: Stats,
  dryRun: boolean
): Promise<void> {
  let results: ExaResult[] = [];
  try {
    const resp = await exaSearch({
      query: buildExaQuery(row),
      apiKey: exaKey,
      numResults: DEFAULT_EXA_RESULTS,
      type: "auto",
      textMaxCharacters: PER_RESULT_CHARS,
    });
    results = resp.results;
  } catch (err) {
    stats.exaErrors++;
    console.warn(`  [${row.name}] exa error: ${err instanceof Error ? err.message : err}`);
    if (!dryRun) {
      await prisma.company.update({
        where: { id: row.id },
        data: { tags: { push: "exa-industry-tried" } },
      });
    }
    return;
  }

  if (results.length === 0) {
    stats.exaEmpty++;
    console.log(`  [${row.name}] no Exa results`);
    if (!dryRun) {
      await prisma.company.update({
        where: { id: row.id },
        data: { tags: { push: "exa-industry-tried" } },
      });
    }
    return;
  }

  const blob = blobFromExa(results);
  const ownDomainSeen = resultsContainOwnDomain(results, row.domain);
  let extracted: { description: string | null; industry: string | null };
  try {
    stats.llmCalls++;
    extracted = await llmExtract(apiKey, blob, row.name);
  } catch (err) {
    stats.llmErrors++;
    console.warn(`  [${row.name}] llm error: ${err instanceof Error ? err.message : err}`);
    if (!dryRun) {
      await prisma.company.update({
        where: { id: row.id },
        data: { tags: { push: "exa-industry-tried" } },
      });
    }
    return;
  }

  const tagsToAdd = ["exa-industry-tried"];
  const data: Record<string, unknown> = {};
  let hit = false;

  if (extracted.description) {
    if (ownDomainSeen) {
      data.description = extracted.description;
      stats.descriptionsWritten++;
      hit = true;
    } else {
      stats.descriptionsSkippedNoDomain++;
    }
  }

  if (extracted.industry === "Unknown") {
    stats.unknownFromModel++;
  } else if (extracted.industry && VOCAB_SET.has(extracted.industry)) {
    data.industry = extracted.industry;
    stats.industriesClassified++;
    hit = true;
    const tag = tagFromTopic(extracted.industry);
    if (tag && !row.tags.includes(tag)) {
      tagsToAdd.push(tag);
      stats.tagAdditions++;
    }
  } else if (extracted.industry) {
    stats.invalidVocab++;
    console.warn(`  [${row.name}] out-of-vocab "${extracted.industry}", skipping`);
  }

  if (hit) tagsToAdd.push("exa-industry-enriched");
  data.tags = { push: tagsToAdd };

  const note = [
    extracted.industry ? `industry=${extracted.industry}` : null,
    extracted.description ? `desc="${extracted.description.slice(0, 60)}..."` : null,
  ].filter(Boolean).join(" ") || "whiff";
  console.log(`  [${row.name}] ${note}`);

  if (!dryRun) {
    stats.writes++;
    await prisma.company.update({ where: { id: row.id }, data });
  }
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  abort: { aborted: boolean; reason: Error | null }
): Promise<boolean> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!abort.aborted) {
      const idx = i++;
      if (idx >= items.length) return;
      try {
        await fn(items[idx]);
      } catch (err) {
        abort.aborted = true;
        abort.reason = err instanceof Error ? err : new Error(String(err));
        return;
      }
    }
  });
  await Promise.all(workers);
  return !abort.aborted;
}

export async function enrichIndustriesExa(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const exaKey = process.env.EXA_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");
  if (!exaKey) throw new Error("EXA_API_KEY is required");

  const limit = parseInt10(parseFlag("--limit"));
  const concurrency = parseInt10(parseFlag("--concurrency")) ?? DEFAULT_CONCURRENCY;
  const dryRun = hasFlag("--dry-run");

  // Target: verified rows that the description-only pass couldn't reach
  // (no description AND no oneLiner) and haven't been tried by this script.
  let companies = await prisma.company.findMany({
    where: {
      isVerified: true,
      industry: null,
      description: null,
      oneLiner: null,
      domain: { not: "" },
      NOT: { tags: { has: "exa-industry-tried" } },
    },
    select: { id: true, name: true, domain: true, tags: true },
    orderBy: { createdAt: "asc" },
  });
  if (limit !== null) companies = companies.slice(0, limit);

  console.log(
    `Found ${companies.length} verified rows missing industry+description.${dryRun ? " (dry-run)" : ""}`
  );
  console.log(`Concurrency: ${concurrency}, Exa results: ${DEFAULT_EXA_RESULTS}, model: ${MODEL}`);

  const stats: Stats = {
    scanned: 0, exaEmpty: 0, exaErrors: 0,
    llmCalls: 0, llmErrors: 0,
    descriptionsWritten: 0, descriptionsSkippedNoDomain: 0,
    industriesClassified: 0,
    unknownFromModel: 0, invalidVocab: 0,
    tagAdditions: 0, writes: 0,
  };

  const abort = { aborted: false, reason: null as Error | null };
  const wrapped = async (row: CompanyRow): Promise<void> => {
    stats.scanned++;
    await processOne(row, exaKey, apiKey, stats, dryRun);
  };

  await runConcurrent(companies as CompanyRow[], concurrency, wrapped, abort);

  console.log("\n--- Run summary ---");
  console.log(`Scanned:                ${stats.scanned}`);
  console.log(`Exa empty:              ${stats.exaEmpty}`);
  console.log(`Exa errors:             ${stats.exaErrors}`);
  console.log(`LLM calls:              ${stats.llmCalls}`);
  console.log(`LLM errors:             ${stats.llmErrors}`);
  console.log(`Descriptions written:   ${stats.descriptionsWritten}`);
  console.log(`Descriptions skipped (no own-domain match): ${stats.descriptionsSkippedNoDomain}`);
  console.log(`Industries classified:  ${stats.industriesClassified}`);
  console.log(`Unknown (model):        ${stats.unknownFromModel}`);
  console.log(`Out-of-vocab:           ${stats.invalidVocab}`);
  console.log(`Tag additions:          ${stats.tagAdditions}`);
  console.log(`DB writes:              ${stats.writes}`);
  if (dryRun) console.log("(dry-run — no DB writes)");
  if (abort.aborted && abort.reason) {
    console.error(`\nAborted: ${abort.reason.message}`);
  }
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  enrichIndustriesExa().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
