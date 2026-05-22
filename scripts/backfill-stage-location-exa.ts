import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { normalizeRegion } from "./_lib/region-map.js";
import { CANONICAL_STAGES, type CanonicalStage } from "./_lib/stages.js";
import { exaSearch, type ExaResult } from "../server/lib/ai/exa-search.js";
import { callClaude } from "../server/lib/ai/anthropic.js";

// One-shot stage + location backfill via Exa. Sibling to
// backfill-stage-location-tavily.ts — same pipeline shape (regex first,
// Haiku JSON fallback), different retrieval backend. Built because Tavily
// hit its monthly quota partway through the 2026-05-13 pass with ~2,400
// stage-null rows still untouched; this script picks up where Tavily left
// off without re-paying for already-enriched rows.
//
// Pipeline (per company):
//   1. Exa /search with `category="news"` and a 5-year recency window.
//      Funding-announcement coverage lives in news pages, so the news
//      category bypasses the company-homepage prose that Tavily's
//      general search would surface first. Date filter trims out
//      Series A press releases from 2014 for companies that have since
//      raised through D/E.
//   2. Regex pass — identical helpers to the Tavily script:
//        - stage: every Series [A-F] / Seed / Pre-Seed match, pick the
//          highest canonical ordinal (latest round wins).
//        - location: anchored "headquartered/based/located in <City>"
//          patterns and "HQ: <City>".
//   3. Haiku fallback for whichever field regex missed when the blob is
//      non-empty. One per-row call (~$0.0001) returning strict JSON.
//   4. Write stage + location (and derived region = normalizeRegion) and
//      tag the row "exa-stage-tried" (always) and "exa-stage-enriched"
//      (on any hit). The tried tag guarantees one-shot semantics — a
//      re-run never re-pays for the same row.
//
// Usage:
//   npx tsx scripts/backfill-stage-location-exa.ts --dry-run --limit 20
//   npx tsx scripts/backfill-stage-location-exa.ts --limit 100
//   npx tsx scripts/backfill-stage-location-exa.ts                       # full pass
//   npx tsx scripts/backfill-stage-location-exa.ts --concurrency 6
//   npx tsx scripts/backfill-stage-location-exa.ts --skip-tavily-tried   # skip rows Tavily already whiffed on
//   npx tsx scripts/backfill-stage-location-exa.ts --only stage          # stage-only target
//
// Re-runnability:
//   - Tags `exa-stage-tried` is the one-shot guard for this script.
//   - Use `--skip-tavily-tried` to also exclude Tavily-whiffed rows when
//     credits are tight (they're more likely to whiff again).

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_EXA_RESULTS = 5;
const PER_RESULT_CHARS = 1200;
// 5-year recency window — covers the typical funding velocity of a
// company in this corpus (Pre-Seed → Series E in 4-6 years). Older press
// releases create noise where regex picks up the earliest round instead
// of the latest.
const RECENCY_YEARS = 5;

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
  stage: string | null;
  location: string | null;
  tags: string[];
}

interface Stats {
  scanned: number;
  exaResultsEmpty: number;
  exaErrors: number;
  stageFilled: number;
  locationFilled: number;
  stageFromRegex: number;
  stageFromLlm: number;
  locationFromRegex: number;
  locationFromLlm: number;
  llmCalls: number;
  llmErrors: number;
  regionDerived: number;
  fullWhiff: number;       // exa returned content but neither field extracted
  writes: number;
}

const CANONICAL_STAGE_SET = new Set<string>(CANONICAL_STAGES);

// Mirrors the private stageOrdinal in _lib/stages.ts. Series C+ shares
// the C floor — it's a legacy aggregation bucket.
function stageOrd(s: string): number {
  if (s === "Pre-Seed") return 0;
  if (s === "Seed") return 1;
  if (s === "Series C+") return 4;
  const m = s.match(/^Series ([A-F])$/);
  if (m) return 2 + (m[1].charCodeAt(0) - "A".charCodeAt(0));
  return -1;
}

const STAGE_RE_PRESEED = /\bpre[-\s]?seed\b/i;
const STAGE_RE_SEED = /\bseed\s+(?:round|funding|investment|stage|capital)\b/i;

const LOCATION_RE = /\b(?:headquartered|headquarters|based|located|head[- ]?quartered)\s+(?:in|at)\s+([A-Z][A-Za-z.'-]+(?:[ -][A-Z][A-Za-z.'-]+){0,3})(?:,\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}))?/;
const LOCATION_RE_HQ = /\bHQ:?\s+([A-Z][A-Za-z.'-]+(?:[ -][A-Z][A-Za-z.'-]+){0,3})(?:,\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}))?/;

const LLM_SYSTEM = `Extract the company's CURRENT funding stage and HQ location from the provided search snippets. Return strict JSON with this exact shape and nothing else:

{"stage": "<one of: Pre-Seed | Seed | Series A | Series B | Series C | Series D | Series E | Series F | null>", "location": "<City, State|Country | null>"}

Rules:
- stage: if multiple rounds are mentioned, return the LATEST (highest letter). If only "raised funding" with no round letter, return null.
- location: return ONLY the headquarters. Skip mentions of offices, customers, founders' hometowns. Use "City, State" for US (e.g., "San Francisco, CA") and "City, Country" for international (e.g., "London, United Kingdom").
- Return null for either field if the snippets don't contain a clear, specific signal. Don't guess.
- Output JSON only — no markdown, no commentary.`;

function buildExaQuery(c: CompanyRow): string {
  // Tighter than the Tavily query because Exa's news category already
  // filters out homepage prose. "raised" and "funding round" pin the
  // topical surface; quoted name pins the entity; domain disambiguates
  // similarly-named companies (e.g., generic SaaS names that overlap
  // with people / products / songs).
  return `"${c.name}" ${c.domain} raised funding round Series`;
}

function blobFromExa(results: ExaResult[]): string {
  return results
    .map(r => `${r.title}\n${r.content.slice(0, PER_RESULT_CHARS)}`)
    .join("\n\n");
}

function maskName(blob: string, name: string): string {
  if (!name) return blob;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return blob.replace(new RegExp(escaped, "gi"), "__COMPANY__");
}

function extractStageRegex(blob: string): CanonicalStage | null {
  const candidates: string[] = [];
  for (const m of blob.matchAll(/\bSeries\s+([A-F])\b/gi)) {
    const letter = m[1].toUpperCase();
    candidates.push(`Series ${letter}`);
  }
  if (STAGE_RE_PRESEED.test(blob)) candidates.push("Pre-Seed");
  if (STAGE_RE_SEED.test(blob)) candidates.push("Seed");
  if (candidates.length === 0) return null;
  let best: { s: string; ord: number } | null = null;
  for (const c of candidates) {
    if (!CANONICAL_STAGE_SET.has(c)) continue;
    const ord = stageOrd(c);
    if (ord < 0) continue;
    if (!best || ord > best.ord) best = { s: c, ord };
  }
  return (best?.s ?? null) as CanonicalStage | null;
}

function cleanLocPart(s: string): string {
  const stop = s.search(/[.\n]|\s{2,}/);
  return (stop >= 0 ? s.slice(0, stop) : s).trim().replace(/[.,;]\s*$/, "");
}

function extractLocationRegex(blob: string): string | null {
  const m = blob.match(LOCATION_RE) ?? blob.match(LOCATION_RE_HQ);
  if (!m) return null;
  const city = cleanLocPart(m[1]);
  if (city.length < 3) return null;
  const country = m[2] ? cleanLocPart(m[2]) : "";
  return country ? `${city}, ${country}` : city;
}

function safeJsonParse(text: string): { stage?: unknown; location?: unknown } | null {
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
  needStage: boolean,
  needLocation: boolean
): Promise<{ stage: CanonicalStage | null; location: string | null }> {
  if (!needStage && !needLocation) return { stage: null, location: null };
  const reply = await callClaude({
    apiKey,
    model: MODEL,
    system: LLM_SYSTEM,
    userContent: `Snippets:\n${blob.slice(0, 6000)}`,
    maxTokens: 200,
  });
  const parsed = safeJsonParse(reply);
  if (!parsed) return { stage: null, location: null };

  let stage: CanonicalStage | null = null;
  if (needStage && typeof parsed.stage === "string" && CANONICAL_STAGE_SET.has(parsed.stage)) {
    stage = parsed.stage as CanonicalStage;
  }
  let location: string | null = null;
  if (needLocation && typeof parsed.location === "string" && parsed.location.length >= 3) {
    location = parsed.location.trim();
  }
  return { stage, location };
}

function isoNYearsAgo(n: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

async function processOne(
  row: CompanyRow,
  exaKey: string,
  apiKey: string,
  stats: Stats,
  dryRun: boolean,
  startPublishedDate: string
): Promise<void> {
  let results: ExaResult[] = [];
  try {
    const resp = await exaSearch({
      query: buildExaQuery(row),
      apiKey: exaKey,
      numResults: DEFAULT_EXA_RESULTS,
      type: "auto",
      category: "news",
      textMaxCharacters: PER_RESULT_CHARS,
      startPublishedDate,
    });
    results = resp.results;
  } catch (err) {
    stats.exaErrors++;
    console.warn(`  [${row.name}] exa error: ${err instanceof Error ? err.message : err}`);
    // exaSearch only throws on 401/403 (auth); transient 5xx already
    // returned an empty result set. Tag tried so we don't keep retrying
    // a misconfigured run.
    if (!dryRun) {
      await prisma.company.update({
        where: { id: row.id },
        data: { tags: { push: "exa-stage-tried" } },
      });
    }
    return;
  }

  if (results.length === 0) {
    stats.exaResultsEmpty++;
    if (!dryRun) {
      await prisma.company.update({
        where: { id: row.id },
        data: { tags: { push: "exa-stage-tried" } },
      });
    }
    return;
  }

  const blob = maskName(blobFromExa(results), row.name);

  let stage: CanonicalStage | null = row.stage === null ? extractStageRegex(blob) : null;
  let location: string | null = row.location === null ? extractLocationRegex(blob) : null;
  if (stage) stats.stageFromRegex++;
  if (location) stats.locationFromRegex++;

  const needStage = row.stage === null && !stage;
  const needLocation = row.location === null && !location;
  if ((needStage || needLocation) && blob.trim().length > 0) {
    try {
      stats.llmCalls++;
      const llm = await llmExtract(apiKey, blob, needStage, needLocation);
      if (needStage && llm.stage) { stage = llm.stage; stats.stageFromLlm++; }
      if (needLocation && llm.location) { location = llm.location; stats.locationFromLlm++; }
    } catch (err) {
      stats.llmErrors++;
      console.warn(`  [${row.name}] llm error: ${err instanceof Error ? err.message : err}`);
    }
  }

  const region = location ? normalizeRegion(location) : null;

  if (stage) stats.stageFilled++;
  if (location) stats.locationFilled++;
  if (region) stats.regionDerived++;
  if (!stage && !location) stats.fullWhiff++;

  const tagsToAdd = ["exa-stage-tried"];
  if (stage || location) tagsToAdd.push("exa-stage-enriched");
  const data: Record<string, unknown> = { tags: { push: tagsToAdd } };
  if (stage) data.stage = stage;
  if (location) data.location = location;
  if (region) data.region = region;

  const note = [
    stage ? `stage=${stage}` : null,
    location ? `loc=${location}` : null,
    region ? `region=${region}` : null,
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

export async function backfillStageLocationExa(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const exaKey = process.env.EXA_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");
  if (!exaKey) throw new Error("EXA_API_KEY is required");

  const limit = parseInt10(parseFlag("--limit"));
  const maxCalls = parseInt10(parseFlag("--max-calls"));
  const concurrency = parseInt10(parseFlag("--concurrency")) ?? DEFAULT_CONCURRENCY;
  const dryRun = hasFlag("--dry-run");
  const skipTavilyTried = hasFlag("--skip-tavily-tried");
  const only = parseFlag("--only"); // 'stage' | 'location' | 'both' | null=>either
  const source = parseFlag("--source"); // optional source-scope filter

  let nullPredicate: Record<string, unknown> = { OR: [{ stage: null }, { location: null }] };
  if (only === "stage") nullPredicate = { stage: null };
  else if (only === "location") nullPredicate = { location: null };
  else if (only === "both") nullPredicate = { AND: [{ stage: null }, { location: null }] };
  else if (only !== null) throw new Error(`--only must be one of: stage | location | both`);

  // NOT clauses: always exclude exa-stage-tried (one-shot guard for THIS
  // script). Optionally also exclude tavily-tried (those rows hit a real
  // search already and whiffed; they're more likely to whiff again, so
  // --skip-tavily-tried is the credit-saver mode).
  const notFilter: Array<Record<string, unknown>> = [
    { tags: { has: "exa-stage-tried" } },
  ];
  if (skipTavilyTried) {
    notFilter.push({ tags: { has: "tavily-tried" } });
  }

  const all = await prisma.company.findMany({
    where: {
      isVerified: true,
      ...(source ? { source } : {}),
      ...nullPredicate,
      NOT: notFilter,
    },
    select: {
      id: true, name: true, domain: true,
      stage: true, location: true, tags: true,
    },
    orderBy: { createdAt: "asc" },
  });
  let companies = limit !== null ? all.slice(0, limit) : all;
  if (maxCalls !== null && companies.length > maxCalls) {
    companies = companies.slice(0, maxCalls);
  }

  const startPublishedDate = isoNYearsAgo(RECENCY_YEARS);

  console.log(
    `Found ${all.length} verified rows missing stage or location (showing ${companies.length}).${dryRun ? " (dry-run)" : ""}`
  );
  if (skipTavilyTried) console.log(`Skipping tavily-tried rows.`);
  if (maxCalls !== null) console.log(`Exa call cap: ${maxCalls}`);
  console.log(`Concurrency: ${concurrency}, Exa results: ${DEFAULT_EXA_RESULTS}, recency: ${RECENCY_YEARS}y (since ${startPublishedDate}), model: ${MODEL}`);

  const stats: Stats = {
    scanned: 0,
    exaResultsEmpty: 0, exaErrors: 0,
    stageFilled: 0, locationFilled: 0,
    stageFromRegex: 0, stageFromLlm: 0,
    locationFromRegex: 0, locationFromLlm: 0,
    llmCalls: 0, llmErrors: 0,
    regionDerived: 0, fullWhiff: 0, writes: 0,
  };

  const abort = { aborted: false, reason: null as Error | null };
  const completed = await runConcurrent(
    companies,
    concurrency,
    async row => {
      stats.scanned++;
      await processOne(row as CompanyRow, exaKey, apiKey, stats, dryRun, startPublishedDate);
    },
    abort
  );

  if (!completed) {
    console.error(`\n!! ABORTED: ${abort.reason?.message ?? "unknown reason"}`);
  }

  console.log("\n--- Run summary ---");
  console.log(`Scanned:                    ${stats.scanned}`);
  console.log(`Stage filled:               ${stats.stageFilled}  (regex=${stats.stageFromRegex}, llm=${stats.stageFromLlm})`);
  console.log(`Location filled:            ${stats.locationFilled}  (regex=${stats.locationFromRegex}, llm=${stats.locationFromLlm})`);
  console.log(`Region derived from loc:    ${stats.regionDerived}`);
  console.log(`LLM fallback calls:         ${stats.llmCalls}  (errors=${stats.llmErrors})`);
  console.log(`Exa empty results:          ${stats.exaResultsEmpty}`);
  console.log(`Exa errors:                 ${stats.exaErrors}`);
  console.log(`Full whiffs (blob, 0 fields): ${stats.fullWhiff}`);
  console.log(`DB writes:                  ${stats.writes}${dryRun ? " (dry-run — would have written)" : ""}`);
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillStageLocationExa().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
