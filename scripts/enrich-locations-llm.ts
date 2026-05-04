import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { normalizeRegion, US_REGIONS } from "./_lib/region-map.js";
import { callClaude } from "../server/lib/ai/anthropic.js";

// LLM-classify Company.region for rows whose region is null.
//
// The audience filter only distinguishes three buckets — US, International,
// Remote — so this script only asks the LLM for that 3-way classification
// (plus "Unknown"). Specific metros come from the deterministic
// `normalizeRegion` pass at ingest; the LLM is only invoked for rows where
// no metro signal exists, so its output is always bucket-level.
//
// Two cheap passes before the LLM:
//   1. normalizeRegion(row.location) — re-run in case the static map gained
//      entries since the original ingest.
//   2. ccTLD inference (.de → "Germany", .uk → "United Kingdom"). High-
//      precision data lookup — ISO 3166-1 alpha-2 codes are a fixed table.
//
// Cost: ~$0.001 per batch of 30 companies on Haiku 4.5. Idempotent.
//
// Usage:
//   npx tsx scripts/enrich-locations-llm.ts                # full run
//   npx tsx scripts/enrich-locations-llm.ts --limit 100
//   npx tsx scripts/enrich-locations-llm.ts --dry-run
//   npx tsx scripts/enrich-locations-llm.ts --batch 30

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_BATCH = 30;

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

interface Stats {
  scanned: number;
  classified: number;
  remote: number;
  us: number;
  intl: number;
  detPass1: number;       // hit normalizeRegion on Company.location
  detPass2Cctld: number;  // hit ccTLD inference on domain
  zeroSignalSkipped: number; // skipped — no description/oneLiner/location/ccTLD
  modelClassified: number; // model returned a usable region
  modelUnknown: number;    // model returned "Unknown"
  modelOmitted: number;    // input id missing from model response (truncation/hallucination)
  modelInvalid: number;    // model returned non-string or unparseable
  errors: number;
}

const SYSTEM = `Classify each company by region. Output strict JSON mapping each input id to ONE of these four values:
  - "US" — headquartered in the United States
  - "International" — headquartered outside the US
  - "Remote" — fully distributed, no specific HQ
  - "Unknown" — truly no signal at all

Use any signal: company name origin, domain TLD, description language, market focus, founder names. Make educated guesses; return "Unknown" only when there is genuinely nothing to go on.

Output rules: do not invent values, do not add commentary, do not wrap in markdown.

Example: {"abc123": "US", "def456": "International", "ghi789": "Remote", "jkl012": "Unknown"}`;

// Maps the 4-bucket model output to the value we store in Company.region.
// "US" is normalized to "United States" so the audience filter's
// `region IN US_REGIONS` test matches it (United States is in US_REGIONS).
const REGION_STORE: Record<string, string> = {
  US: "United States",
  International: "International",
  Remote: "Remote",
};

interface CompanyRow {
  id: string;
  name: string;
  location: string | null;
  oneLiner: string | null;
  description: string | null;
  website: string | null;
  domain: string;
}

// ccTLD → country lookup. Very high precision — if a company's domain ends
// in .de, it's a German company. Generic TLDs (.com, .io, .app) skip this
// pass and fall through to the LLM. Mapping the most common ccTLDs only;
// the long tail goes through Claude.
const CC_TLD_TO_COUNTRY: Record<string, string> = {
  uk: "United Kingdom", gb: "United Kingdom",
  de: "Germany", fr: "France", es: "Spain", it: "Italy", nl: "Netherlands",
  se: "Sweden", no: "Norway", fi: "Finland", dk: "Denmark", pl: "Poland",
  ie: "Ireland", be: "Belgium", at: "Austria", ch: "Switzerland",
  ca: "Canada", mx: "Mexico", br: "Brazil", ar: "Argentina", cl: "Chile",
  co: "Colombia", pe: "Peru",
  jp: "Japan", cn: "China", in: "India", kr: "South Korea", hk: "Hong Kong",
  tw: "Taiwan", sg: "Singapore", id: "Indonesia", th: "Thailand",
  vn: "Vietnam", my: "Malaysia", ph: "Philippines", pk: "Pakistan",
  au: "Australia", nz: "New Zealand",
  ae: "United Arab Emirates", il: "Israel", sa: "Saudi Arabia",
  za: "South Africa", ng: "Nigeria", ke: "Kenya", eg: "Egypt",
  ru: "Russia", tr: "Turkey", ua: "Ukraine",
};

function inferRegionFromDomain(domain: string | null): string | null {
  if (!domain) return null;
  const last = domain.toLowerCase().split(".").pop();
  if (!last) return null;
  return CC_TLD_TO_COUNTRY[last] ?? null;
}

function buildPrompt(rows: CompanyRow[]): string {
  const lines = rows.map(r => {
    const parts = [`name=${r.name}`];
    if (r.location) parts.push(`location=${r.location}`);
    if (r.domain) parts.push(`domain=${r.domain}`);
    if (r.oneLiner) parts.push(`one-liner=${r.oneLiner.slice(0, 120)}`);
    else if (r.description) parts.push(`description=${r.description.slice(0, 200)}`);
    return `${r.id} | ${parts.join(" | ")}`;
  });
  return `Classify each of the following companies into a region. Return JSON only.\n\n${lines.join("\n")}`;
}

function safeJsonParse(text: string): Record<string, string> | null {
  // Strip markdown fences just in case the model wraps despite instructions.
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/g, "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}


export async function enrichLocations(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is required in environment.");
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  const limit = parseInt10(parseFlag("--limit"));
  const batchSize = parseInt10(parseFlag("--batch")) ?? DEFAULT_BATCH;
  const dryRun = hasFlag("--dry-run");

  let companies = await prisma.company.findMany({
    where: { isVerified: true, region: null },
    select: {
      id: true, name: true, location: true,
      oneLiner: true, description: true, website: true, domain: true,
    },
    orderBy: { createdAt: "asc" },
  });
  if (limit !== null) companies = companies.slice(0, limit);

  console.log(
    `Found ${companies.length} verified companies missing region.${dryRun ? " (dry-run)" : ""}`
  );
  console.log(`Batch size: ${batchSize}, model: ${MODEL}`);

  const stats: Stats = {
    scanned: 0, classified: 0, remote: 0, us: 0, intl: 0,
    detPass1: 0, detPass2Cctld: 0, zeroSignalSkipped: 0,
    modelClassified: 0, modelUnknown: 0, modelOmitted: 0, modelInvalid: 0,
    errors: 0,
  };
  const omittedSamples: string[] = [];

  for (let i = 0; i < companies.length; i += batchSize) {
    const batch = companies.slice(i, i + batchSize) as CompanyRow[];
    stats.scanned += batch.length;

    try {
      // Cheap deterministic passes first. Strips trivial cases out of the
      // LLM batch — both for cost and to avoid the model second-guessing
      // signals we can already read directly.
      const remaining: CompanyRow[] = [];
      for (const row of batch) {
        // Pass 1: re-run normalizeRegion in case the static map gained
        // entries since the original ingest.
        const local = row.location ? normalizeRegion(row.location) : null;
        if (local) {
          if (!dryRun) await prisma.company.update({ where: { id: row.id }, data: { region: local } });
          stats.classified++;
          stats.detPass1++;
          if (local === "Remote") stats.remote++;
          else if (US_REGIONS.has(local)) stats.us++;
          else stats.intl++;
          continue;
        }
        // Pass 2: ccTLD inference. .uk → United Kingdom, .de → Germany, etc.
        const tld = inferRegionFromDomain(row.domain);
        if (tld) {
          if (!dryRun) await prisma.company.update({ where: { id: row.id }, data: { region: tld } });
          stats.classified++;
          stats.detPass2Cctld++;
          stats.intl++;
          continue;
        }
        // Pre-filter: rows with no description, no oneLiner, no location, and
        // a generic TLD have nothing for the model to work with — Claude will
        // return Unknown 100% of the time. Skip to save API cost.
        const hasContextSignal = !!(row.location || row.oneLiner || row.description);
        if (!hasContextSignal) {
          stats.zeroSignalSkipped++;
          continue;
        }
        remaining.push(row);
      }
      if (remaining.length === 0) continue;

      const reply = await callClaude({
        apiKey,
        model: MODEL,
        system: SYSTEM,
        userContent: buildPrompt(remaining),
        // 20-row batches with verbose region strings can push past 800; bumped
        // to 1500 to eliminate truncation as a source of "model_omitted".
        maxTokens: 1500,
      });
      const parsed = safeJsonParse(reply);
      if (!parsed) {
        stats.errors += remaining.length;
        console.error(`  batch ${i}-${i + batch.length}: model returned non-JSON, skipping.`);
        await sleep(500);
        continue;
      }

      for (const row of remaining) {
        const raw = parsed[row.id];
        if (raw === undefined) {
          stats.modelOmitted++;
          if (omittedSamples.length < 5) {
            omittedSamples.push(`${row.name} (loc=${row.location ?? "∅"} dom=${row.domain})`);
          }
          continue;
        }
        if (typeof raw !== "string") { stats.modelInvalid++; continue; }
        if (raw === "Unknown") { stats.modelUnknown++; continue; }
        const region = REGION_STORE[raw];
        if (!region) { stats.modelInvalid++; continue; }
        if (raw === "US") stats.us++;
        else if (raw === "Remote") stats.remote++;
        else stats.intl++;
        stats.classified++;
        stats.modelClassified++;

        console.log(`  ${row.name}: ${row.location ?? "∅"} -> ${region}`);
        if (!dryRun) {
          await prisma.company.update({ where: { id: row.id }, data: { region } });
        }
      }
    } catch (err) {
      stats.errors += batch.length;
      console.error(`  batch ${i}: error — ${err instanceof Error ? err.message : err}`);
    }
    // Light spacing — Anthropic rate limits are generous but no need to
    // hammer them.
    await sleep(400);
  }

  console.log("\n--- Run summary ---");
  console.log(`Scanned:                ${stats.scanned}`);
  console.log(`Classified:             ${stats.classified}`);
  console.log(`  US:                   ${stats.us}`);
  console.log(`  International:        ${stats.intl}`);
  console.log(`  Remote:               ${stats.remote}`);
  console.log(`  via det pass 1 (loc): ${stats.detPass1}`);
  console.log(`  via det pass 2 (TLD): ${stats.detPass2Cctld}`);
  console.log(`  via model:            ${stats.modelClassified}`);
  console.log(`Skipped (zero signal):  ${stats.zeroSignalSkipped}  (no loc/desc/oneLiner/ccTLD)`);
  console.log(`Model returned Unknown: ${stats.modelUnknown}`);
  console.log(`Model omitted id:       ${stats.modelOmitted}  (truncation/hallucination)`);
  console.log(`Model invalid value:    ${stats.modelInvalid}`);
  console.log(`Errors (batch failed):  ${stats.errors}`);
  if (omittedSamples.length > 0) {
    console.log(`\nSample omitted rows (model didn't return their id):`);
    for (const s of omittedSamples) console.log(`  - ${s}`);
  }
  if (dryRun) console.log("(dry-run — no DB writes)");
  await prisma.$disconnect();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  enrichLocations().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
