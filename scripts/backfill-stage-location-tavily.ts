import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { normalizeRegion } from "./_lib/region-map.js";
import { CANONICAL_STAGES, type CanonicalStage } from "./_lib/stages.js";
import { tavilySearch, TavilyQuotaError, type TavilyResult } from "../server/lib/ai/tavily-search.js";
import { callClaude } from "../server/lib/ai/anthropic.js";

// One-shot backfill: fills Company.stage and Company.location for verified
// rows where either is null, using one Tavily call per company. Both fields
// are extracted from the same snippet bundle so we only spend one credit
// per row regardless of which field(s) were missing.
//
// Pipeline (per company):
//   1. Tavily /search (advanced, 4 results) for "<name> <domain> headquarters
//      funding Series". Concatenate result.content into a single blob.
//   2. Regex pass:
//        - stage:    find all "Series [A-F]" / "Seed" / "Pre-Seed" matches,
//                    map to canonical stage names, take the HIGHEST ordinal
//                    (latest round wins — handles "raised Series A in 2022
//                    and Series B in 2024" cleanly).
//        - location: anchored on "headquartered/based/located in <City>".
//   3. Haiku fallback for whichever field regex missed when the blob is
//      non-empty. One per-row call (~$0.0001) returning JSON.
//   4. Write stage + location (and derived region = normalizeRegion(location))
//      and tag the row 'tavily-tried' (always) and 'tavily-enriched' (on any
//      hit). The 'tavily-tried' tag guarantees one-shot semantics — re-runs
//      skip rows we've already touched.
//
// Usage:
//   npx tsx scripts/backfill-stage-location-tavily.ts --dry-run --limit 20
//   npx tsx scripts/backfill-stage-location-tavily.ts --limit 100
//   npx tsx scripts/backfill-stage-location-tavily.ts                  # full pass
//   npx tsx scripts/backfill-stage-location-tavily.ts --concurrency 8

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_TAVILY_RESULTS = 4;
const PER_RESULT_CHARS = 1200;

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
  tavilyResultsEmpty: number;
  tavilyErrors: number;
  stageFilled: number;
  locationFilled: number;
  stageFromRegex: number;
  stageFromLlm: number;
  locationFromRegex: number;
  locationFromLlm: number;
  llmCalls: number;
  llmErrors: number;
  regionDerived: number;
  fullWhiff: number;       // tavily returned content but neither field extracted
  writes: number;
}

// Lowercase canonical stage lookup for LLM output validation.
const CANONICAL_STAGE_SET = new Set<string>(CANONICAL_STAGES);

// Ordinal for "take the highest letter" disambiguation. Mirrors the private
// stageOrdinal in _lib/stages.ts (which isn't exported). Series C+ is a
// legacy aggregation bucket and shares the C floor.
function stageOrd(s: string): number {
  if (s === "Pre-Seed") return 0;
  if (s === "Seed") return 1;
  if (s === "Series C+") return 4;
  const m = s.match(/^Series ([A-F])$/);
  if (m) return 2 + (m[1].charCodeAt(0) - "A".charCodeAt(0));
  return -1;
}

// Stage regex: anchor on the canonical phrasing actually used in press
// releases. "raised a Series B", "closed its Series C round", "Seed round of
// $X", "Pre-Seed funding". Plain "Series A" with no surrounding context is
// included too — it's almost always about the round in this domain.
//
// Series regex is built fresh in extractStageRegex (matchAll). Don't hoist
// it module-level with the `g` flag — JS regex state (`lastIndex`) is shared
// across concurrent workers and corrupts the iterator.
const STAGE_RE_PRESEED = /\bpre[-\s]?seed\b/i;
const STAGE_RE_SEED = /\bseed\s+(?:round|funding|investment|stage|capital)\b/i;

// Location regex: anchor on a preposition phrase so we don't match arbitrary
// "City, ST" mentions (customers, offices, etc.). Capture splits into two
// groups so we can terminate cleanly at the country/state boundary:
//   group 1 — city: 1-4 title-cased tokens (allows "San Francisco", "Tel
//             Aviv-Yafo", "New York")
//   group 2 — country/state (optional): up to 3 title-cased tokens after a
//             comma. Strictly title-cased so a trailing lowercase verb
//             ("building", "offering") stops the match instead of getting
//             slurped into the location string.
const LOCATION_RE = /\b(?:headquartered|headquarters|based|located|head[- ]?quartered)\s+(?:in|at)\s+([A-Z][A-Za-z.'-]+(?:[ -][A-Z][A-Za-z.'-]+){0,3})(?:,\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}))?/;
const LOCATION_RE_HQ = /\bHQ:?\s+([A-Z][A-Za-z.'-]+(?:[ -][A-Z][A-Za-z.'-]+){0,3})(?:,\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}))?/;

const LLM_SYSTEM = `Extract the company's CURRENT funding stage and HQ location from the provided search snippets. Return strict JSON with this exact shape and nothing else:

{"stage": "<one of: Pre-Seed | Seed | Series A | Series B | Series C | Series D | Series E | Series F | null>", "location": "<City, State|Country | null>"}

Rules:
- stage: if multiple rounds are mentioned, return the LATEST (highest letter). If only "raised funding" with no round letter, return null.
- location: return ONLY the headquarters. Skip mentions of offices, customers, founders' hometowns. Use "City, State" for US (e.g., "San Francisco, CA") and "City, Country" for international (e.g., "London, United Kingdom").
- Return null for either field if the snippets don't contain a clear, specific signal. Don't guess.
- Output JSON only — no markdown, no commentary.`;

function buildTavilyQuery(c: CompanyRow): string {
  // Quoted name pins the entity; domain is a second disambiguator. "raised"
  // is the headline verb of nearly every funding press release; "Series" OR
  // "Seed" forces a round letter into the result set; "headquarters" keeps
  // the location signal in scope.
  return `"${c.name}" ${c.domain} raised "Series" OR "Seed" headquarters`;
}

function blobFromTavily(results: TavilyResult[]): string {
  return results
    .map(r => `${r.title}\n${r.content.slice(0, PER_RESULT_CHARS)}`)
    .join("\n\n");
}

// Strip the company name from the blob before regex matches so e.g. a
// company called "Series Group" doesn't trigger STAGE_RE_SERIES, and "Based
// (San Francisco)" Inc. doesn't fake a location hit.
function maskName(blob: string, name: string): string {
  if (!name) return blob;
  // Escape regex metacharacters in name.
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
  // Pick highest ordinal.
  let best: { s: string; ord: number } | null = null;
  for (const c of candidates) {
    if (!CANONICAL_STAGE_SET.has(c)) continue;
    const ord = stageOrd(c);
    if (ord < 0) continue;
    if (!best || ord > best.ord) best = { s: c, ord };
  }
  return (best?.s ?? null) as CanonicalStage | null;
}

// Truncate at first sentence end / newline so a regex that walked past a
// period (e.g. "United States.\n\nAs the company...") gets clipped back to
// "United States" before we store it.
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

async function processOne(
  row: CompanyRow,
  tavilyKey: string,
  apiKey: string,
  stats: Stats,
  dryRun: boolean
): Promise<void> {
  let results: TavilyResult[] = [];
  try {
    const resp = await tavilySearch({
      query: buildTavilyQuery(row),
      apiKey: tavilyKey,
      maxResults: DEFAULT_TAVILY_RESULTS,
      searchDepth: "advanced",
      // Surface 402/429 as a typed error so the runner can abort cleanly
      // without burning the one-shot tag on rows that were quota-blocked
      // rather than genuinely uninformative.
      throwOnQuota: true,
    });
    results = resp.results;
  } catch (err) {
    // Quota / rate-limit: re-throw so the runner aborts the whole pass. The
    // row is NOT tagged tavily-tried; a future resume will retry it.
    if (err instanceof TavilyQuotaError) throw err;
    stats.tavilyErrors++;
    console.warn(`  [${row.name}] tavily error: ${err instanceof Error ? err.message : err}`);
    // Non-quota errors still tag tried — those are per-row failures we don't
    // want to keep paying for on every re-run.
    if (!dryRun) {
      await prisma.company.update({
        where: { id: row.id },
        data: { tags: { push: "tavily-tried" } },
      });
    }
    return;
  }

  if (results.length === 0) {
    stats.tavilyResultsEmpty++;
    if (!dryRun) {
      await prisma.company.update({
        where: { id: row.id },
        data: { tags: { push: "tavily-tried" } },
      });
    }
    return;
  }

  const blob = maskName(blobFromTavily(results), row.name);

  let stage: CanonicalStage | null = row.stage === null ? extractStageRegex(blob) : null;
  let location: string | null = row.location === null ? extractLocationRegex(blob) : null;
  if (stage) stats.stageFromRegex++;
  if (location) stats.locationFromRegex++;

  // LLM fallback only for fields we still need and only if the blob has content.
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

  // Derived region from new location (only if we filled location this run).
  const region = location ? normalizeRegion(location) : null;

  if (stage) stats.stageFilled++;
  if (location) stats.locationFilled++;
  if (region) stats.regionDerived++;
  if (!stage && !location) stats.fullWhiff++;

  // Compose update.
  const tagsToAdd = ["tavily-tried"];
  if (stage || location) tagsToAdd.push("tavily-enriched");
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

// Tiny inline concurrency runner — keeps N in-flight, drains in order.
// Returns true if completed normally, false if aborted via the shared flag
// (set when a quota error fires in any worker so peers stop pulling work).
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
        // Mark the run aborted; peer workers see the flag and exit. We do
        // NOT rethrow — the outer caller checks the abort state to decide
        // how to report the partial run.
        abort.aborted = true;
        abort.reason = err instanceof Error ? err : new Error(String(err));
        return;
      }
    }
  });
  await Promise.all(workers);
  return !abort.aborted;
}

export async function backfillStageLocationTavily(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");
  if (!tavilyKey) throw new Error("TAVILY_API_KEY is required");

  const limit = parseInt10(parseFlag("--limit"));
  const maxCalls = parseInt10(parseFlag("--max-calls"));
  const concurrency = parseInt10(parseFlag("--concurrency")) ?? DEFAULT_CONCURRENCY;
  const dryRun = hasFlag("--dry-run");
  const only = parseFlag("--only"); // 'stage' | 'location' | 'both' | null=>either

  // Target predicate by --only:
  //   default (either): stage IS NULL OR location IS NULL
  //   --only stage:     stage IS NULL
  //   --only location:  location IS NULL
  //   --only both:      stage IS NULL AND location IS NULL
  let nullPredicate: Record<string, unknown> = { OR: [{ stage: null }, { location: null }] };
  if (only === "stage") nullPredicate = { stage: null };
  else if (only === "location") nullPredicate = { location: null };
  else if (only === "both") nullPredicate = { AND: [{ stage: null }, { location: null }] };
  else if (only !== null) throw new Error(`--only must be one of: stage | location | both`);

  const all = await prisma.company.findMany({
    where: {
      isVerified: true,
      ...nullPredicate,
      NOT: { tags: { has: "tavily-tried" } },
    },
    select: {
      id: true, name: true, domain: true,
      stage: true, location: true, tags: true,
    },
    orderBy: { createdAt: "asc" },
  });
  // --max-calls is the credit-safety cap. It's applied AFTER --limit if both
  // are present (so --limit defines the target window and --max-calls bounds
  // the per-invocation spend within it).
  let companies = limit !== null ? all.slice(0, limit) : all;
  if (maxCalls !== null && companies.length > maxCalls) {
    companies = companies.slice(0, maxCalls);
  }

  console.log(
    `Found ${all.length} verified rows missing stage or location (showing ${companies.length}).${dryRun ? " (dry-run)" : ""}`
  );
  if (maxCalls !== null) console.log(`Tavily call cap: ${maxCalls}`);
  console.log(`Concurrency: ${concurrency}, Tavily results: ${DEFAULT_TAVILY_RESULTS}, model: ${MODEL}`);

  const stats: Stats = {
    scanned: 0,
    tavilyResultsEmpty: 0, tavilyErrors: 0,
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
      await processOne(row as CompanyRow, tavilyKey, apiKey, stats, dryRun);
    },
    abort
  );

  if (!completed) {
    console.error(`\n!! ABORTED: ${abort.reason?.message ?? "unknown reason"}`);
    if (abort.reason instanceof TavilyQuotaError) {
      console.error(`   Tavily ${abort.reason.status} — out of credits or rate-limited.`);
      console.error(`   No tavily-tried tags were applied to in-flight rows; rerun after quota resets.`);
    }
  }

  console.log("\n--- Run summary ---");
  console.log(`Scanned:                    ${stats.scanned}`);
  console.log(`Stage filled:               ${stats.stageFilled}  (regex=${stats.stageFromRegex}, llm=${stats.stageFromLlm})`);
  console.log(`Location filled:            ${stats.locationFilled}  (regex=${stats.locationFromRegex}, llm=${stats.locationFromLlm})`);
  console.log(`Region derived from loc:    ${stats.regionDerived}`);
  console.log(`LLM fallback calls:         ${stats.llmCalls}  (errors=${stats.llmErrors})`);
  console.log(`Tavily empty results:       ${stats.tavilyResultsEmpty}`);
  console.log(`Tavily errors:              ${stats.tavilyErrors}`);
  console.log(`Full whiffs (blob, 0 fields): ${stats.fullWhiff}`);
  console.log(`DB writes:                  ${stats.writes}${dryRun ? " (dry-run — would have written)" : ""}`);
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillStageLocationTavily().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
