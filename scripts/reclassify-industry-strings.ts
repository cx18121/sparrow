import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { mergeTags, tagFromTopic } from "./_lib/tags.js";
import { callClaude } from "../server/lib/ai/anthropic.js";

// Companies with Company.industry SET but no derived vertical:* / tech:* tag.
// These are the ~3000 rows the audience filter silently misses even though
// they have an industry label — the label just doesn't match any alias in
// scripts/_lib/tags.ts so buildTags couldn't produce a tag.
//
// Two passes:
//   1. Free deterministic: run tagFromTopic on the existing industry string.
//      Catches anything that drifted past the wider alias list since the
//      original ingest ran (or where the ingestor never called buildTags).
//   2. Claude Haiku batched: ask the model which canonical bucket the raw
//      industry string belongs to. Closed vocabulary so output round-trips.
//
// Company.industry is left untouched — the original label may carry useful
// specificity ("AdTech & Marketing" vs "marketing"). We only add tags.
//
// Cost: ~$0.20 over ~3000 rows (Claude Haiku 4.5, batches of 25).
//
// Usage:
//   npx tsx scripts/reclassify-industry-strings.ts                # full run
//   npx tsx scripts/reclassify-industry-strings.ts --limit 100    # cap rows
//   npx tsx scripts/reclassify-industry-strings.ts --dry-run      # log only
//   npx tsx scripts/reclassify-industry-strings.ts --batch 25     # rows per call

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_BATCH = 25;

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

function parseFlag(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}
function hasFlag(name: string): boolean { return process.argv.includes(name); }
function parseInt10(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

interface Stats {
  scanned: number;
  deterministicHits: number;
  llmHits: number;
  unknown: number;
  invalid: number;
  errors: number;
}

const SYSTEM = `You map a raw industry label to one of a fixed canonical vocabulary.

Output rules:
1. Return strict JSON: an object mapping each input id to one canonical industry string.
2. The canonical industry MUST be one of: ${VOCAB.join(", ")}.
3. Pick the single best fit. If torn between vertical and tech, pick the vertical.
4. If the raw label is too vague to map (e.g., "other", "various", "consulting", "services"), return "Unknown".
5. Do not invent values, do not add commentary, do not wrap in markdown.

Example output:
{"abc123": "fintech", "def456": "ai", "ghi789": "Unknown"}`;

interface CompanyRow {
  id: string;
  name: string;
  industry: string;
  tags: string[];
}

function buildPrompt(rows: CompanyRow[]): string {
  const lines = rows.map(r => `${r.id} | ${r.name} | industry=${r.industry}`);
  return `Map each company's raw industry label to a canonical bucket. Return JSON only.\n\n${lines.join("\n")}`;
}

function safeJsonParse(text: string): Record<string, string> | null {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/g, "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch { return null; }
}

function hasVerticalOrTechTag(tags: string[]): boolean {
  return tags.some(t => t.startsWith("vertical:") || t.startsWith("tech:") ||
                         t.startsWith("model:") || t.startsWith("function:") ||
                         t.startsWith("media:") || t.startsWith("social:"));
}

export async function reclassifyIndustryStrings(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is required in environment.");
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  const limit = parseInt10(parseFlag("--limit"));
  const batchSize = parseInt10(parseFlag("--batch")) ?? DEFAULT_BATCH;
  const dryRun = hasFlag("--dry-run");

  // Pull all verified rows with industry set; filter the no-tag ones in JS
  // so the filter logic stays readable. The Prisma any/none for tag prefix
  // matching is doable but uglier than this.
  let companies = await prisma.company.findMany({
    where: { isVerified: true, industry: { not: null } },
    select: { id: true, name: true, industry: true, tags: true },
    orderBy: { createdAt: "asc" },
  });
  const candidates = companies.filter(c => !hasVerticalOrTechTag(c.tags)) as CompanyRow[];
  const scoped = limit !== null ? candidates.slice(0, limit) : candidates;

  console.log(
    `Found ${scoped.length} verified companies with industry set but no canonical tag.${dryRun ? " (dry-run)" : ""}`
  );
  console.log(`Batch size: ${batchSize}, model: ${MODEL}`);

  const stats: Stats = {
    scanned: 0, deterministicHits: 0, llmHits: 0,
    unknown: 0, invalid: 0, errors: 0,
  };

  for (let i = 0; i < scoped.length; i += batchSize) {
    const batch = scoped.slice(i, i + batchSize);
    stats.scanned += batch.length;

    try {
      // Pass 1: deterministic. The alias list in tags.ts has been refined a
      // bunch of times — re-running tagFromTopic catches anything that newly
      // matches without a model call.
      const remaining: CompanyRow[] = [];
      for (const row of batch) {
        const tag = tagFromTopic(row.industry);
        if (tag) {
          stats.deterministicHits++;
          console.log(`  [det] ${row.name}: industry="${row.industry}" -> +${tag}`);
          if (!dryRun) {
            await prisma.company.update({
              where: { id: row.id },
              data: { tags: mergeTags(row.tags, [tag]) },
            });
          }
          continue;
        }
        remaining.push(row);
      }
      if (remaining.length === 0) continue;

      // Pass 2: ask Claude.
      const reply = await callClaude({
        apiKey,
        model: MODEL,
        system: SYSTEM,
        userContent: buildPrompt(remaining),
        maxTokens: 1200,
      });
      const parsed = safeJsonParse(reply);
      if (!parsed) {
        stats.errors += remaining.length;
        console.error(`  batch ${i}: model returned non-JSON, skipping.`);
        await sleep(500);
        continue;
      }

      for (const row of remaining) {
        const canonical = parsed[row.id];
        if (!canonical || typeof canonical !== "string") { stats.invalid++; continue; }
        if (canonical === "Unknown") { stats.unknown++; continue; }
        if (!VOCAB_SET.has(canonical)) {
          stats.invalid++;
          console.error(`  ${row.name}: model returned out-of-vocab "${canonical}", skipping.`);
          continue;
        }
        const tag = tagFromTopic(canonical);
        if (!tag) { stats.invalid++; continue; }
        stats.llmHits++;
        console.log(`  ${row.name}: industry="${row.industry}" -> +${tag}`);
        if (!dryRun) {
          await prisma.company.update({
            where: { id: row.id },
            data: { tags: mergeTags(row.tags, [tag]) },
          });
        }
      }
    } catch (err) {
      stats.errors += batch.length;
      console.error(`  batch ${i}: error — ${err instanceof Error ? err.message : err}`);
    }
    await sleep(400);
  }

  console.log("\n--- Run summary ---");
  console.log(`Scanned:                ${stats.scanned}`);
  console.log(`Deterministic hits:     ${stats.deterministicHits}`);
  console.log(`LLM hits:               ${stats.llmHits}`);
  console.log(`Unknown (model gave up): ${stats.unknown}`);
  console.log(`Invalid response:       ${stats.invalid}`);
  console.log(`Errors:                 ${stats.errors}`);
  if (dryRun) console.log("(dry-run — no DB writes)");
  await prisma.$disconnect();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reclassifyIndustryStrings().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
