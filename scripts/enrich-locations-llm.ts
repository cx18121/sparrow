import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { normalizeRegion, US_REGIONS } from "./_lib/region-map.js";
import { callClaude } from "../server/lib/ai/anthropic.js";

// LLM-classify Company.region for rows whose region is null. Two passes:
//   1. Free deterministic ccTLD inference (e.g., .de → "Germany"). Many
//      international companies have a country-code TLD that pins region
//      without spending a Claude call.
//   2. Claude Haiku on whatever signal is available (location string,
//      one-liner, description, website TLD) for the rest.
//
// Uses the host's ANTHROPIC_API_KEY env var.
//
// The classifier returns one of:
//   - a US metro name from US_REGIONS (e.g., "Bay Area", "New York Metro")
//   - "Remote"
//   - "International"
//   - a country name like "Germany" or "Singapore" (also bucketed as
//     International by the audience-query exclusion list at filter time)
//
// Cost: roughly $0.001 per batch of 20 companies on Haiku 4.5. For ~2000
// rows that's ~$0.10. Idempotent — only touches rows where region is null.
//
// Usage:
//   npx tsx scripts/enrich-locations-llm.ts                # full run
//   npx tsx scripts/enrich-locations-llm.ts --limit 100    # cap rows
//   npx tsx scripts/enrich-locations-llm.ts --dry-run      # log only
//   npx tsx scripts/enrich-locations-llm.ts --batch 30     # rows per call

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_BATCH = 20;
const VALID_US_REGIONS = Array.from(US_REGIONS);

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
  unrecognized: number;
  errors: number;
}

const SYSTEM = `You classify company locations into a small fixed vocabulary.

Output rules:
1. Return strict JSON: an object mapping each input id to its region string.
2. Each region must be EXACTLY one of:
   - A US metro name from this list: ${VALID_US_REGIONS.join(", ")}
   - "Remote" (the company is fully distributed)
   - "International" (any non-US location, when no specific country fits)
   - A specific country name (e.g., "Germany", "Singapore", "United Kingdom") — for non-US, non-remote
3. If the input is too ambiguous to classify (e.g., empty, a job title), return "Unknown" for that id.
4. Do not invent fields, do not add commentary, do not wrap in markdown code blocks.

Example output:
{"abc123": "Bay Area", "def456": "Germany", "ghi789": "Remote", "jkl012": "Unknown"}`;

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

function categoriseRegion(region: string): "us" | "remote" | "intl" | "unknown" {
  if (region === "Remote") return "remote";
  if (region === "Unknown") return "unknown";
  if (US_REGIONS.has(region)) return "us";
  return "intl";
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
    unrecognized: 0, errors: 0,
  };

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
          stats.intl++;
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
        maxTokens: 800,
      });
      const parsed = safeJsonParse(reply);
      if (!parsed) {
        stats.errors += remaining.length;
        console.error(`  batch ${i}-${i + batch.length}: model returned non-JSON, skipping.`);
        await sleep(500);
        continue;
      }

      for (const row of remaining) {
        const region = parsed[row.id];
        if (!region || typeof region !== "string") {
          stats.unrecognized++;
          continue;
        }
        if (region === "Unknown") {
          stats.unrecognized++;
          continue;
        }
        const bucket = categoriseRegion(region);
        if (bucket === "unknown") { stats.unrecognized++; continue; }
        if (bucket === "us") stats.us++;
        else if (bucket === "remote") stats.remote++;
        else stats.intl++;
        stats.classified++;

        console.log(`  ${row.name}: ${row.location} -> ${region}`);
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
  console.log(`Scanned:           ${stats.scanned}`);
  console.log(`Classified:        ${stats.classified}`);
  console.log(`  US:              ${stats.us}`);
  console.log(`  International:   ${stats.intl}`);
  console.log(`  Remote:          ${stats.remote}`);
  console.log(`Unrecognized:      ${stats.unrecognized}`);
  console.log(`Errors:            ${stats.errors}`);
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
