import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { mergeTags, tagFromTopic } from "./_lib/tags.js";
import { callClaude } from "../server/lib/ai/anthropic.js";

// LLM-classify Company.industry for rows the SIC/NAICS pass couldn't fill.
// Uses Claude Haiku via the host's ANTHROPIC_API_KEY env var.
//
// The classifier returns one of the canonical industry aliases recognized by
// tagFromTopic in scripts/_lib/tags.ts (e.g., "fintech", "health", "biotech",
// "ecommerce", "saas", "ai", "devtools"). When the model sets a value, the
// matching namespaced tag (e.g., "vertical:fintech") is also added so the
// wizard's filter pills surface it immediately.
//
// Cost: roughly $0.001 per batch of 15 companies on Haiku 4.5. For ~3000
// rows that's ~$0.20. Idempotent — only touches rows where industry is null.
//
// Usage:
//   npx tsx scripts/enrich-industries-llm.ts                # full run
//   npx tsx scripts/enrich-industries-llm.ts --limit 100    # cap rows
//   npx tsx scripts/enrich-industries-llm.ts --dry-run      # log only
//   npx tsx scripts/enrich-industries-llm.ts --batch 20     # rows per call

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_BATCH = 15;

// Closed vocabulary the classifier picks from. The exact strings are aliases
// known to tagFromTopic — adding others would write industry values that
// can't be mapped back to a tag, which defeats the purpose.
const VOCAB = [
  // verticals
  "fintech", "health", "biotech", "education", "legal", "real estate",
  "govtech", "agriculture", "climate", "energy", "industrial", "logistics",
  "ecommerce", "gaming", "sports", "travel", "food", "fashion", "beauty",
  "pets", "parenting", "dating", "automotive",
  // tech
  "ai", "crypto", "devtools", "devops", "infrastructure", "security",
  "data", "analytics", "nocode", "api", "web", "mobile", "iot", "xr",
  "hardware", "robotics", "automation",
  // models / functions
  "saas", "marketplace", "consumer", "b2b",
  "marketing", "sales", "hr", "productivity", "design", "content",
  "communication", "search",
  // media
  "video", "audio", "music", "podcast", "photo",
  // social
  "social", "community",
];

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
  unknown: number;
  invalid: number;
  tagsAdded: number;
  errors: number;
}

const SYSTEM = `You classify companies into one of a fixed industry vocabulary.

Output rules:
1. Return strict JSON: an object mapping each input id to one industry string.
2. The industry MUST be one of: ${VOCAB.join(", ")}.
3. Pick the single best fit. If torn between vertical and tech, pick the vertical (e.g., "fintech" wins over "ai" for an AI-for-banking startup).
4. If you cannot tell from the description and one-liner, return "Unknown" for that id.
5. Do not invent values, do not add commentary, do not wrap in markdown.

Example output:
{"abc123": "fintech", "def456": "devtools", "ghi789": "Unknown"}`;

interface CompanyRow {
  id: string;
  name: string;
  oneLiner: string | null;
  description: string | null;
  tags: string[];
}

function buildPrompt(rows: CompanyRow[]): string {
  const lines = rows.map(r => {
    const blurb = r.oneLiner ?? r.description?.slice(0, 200) ?? "(no description)";
    return `${r.id} | ${r.name} | ${blurb}`;
  });
  return `Classify each of the following companies. Return JSON only.\n\n${lines.join("\n")}`;
}

function safeJsonParse(text: string): Record<string, string> | null {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/g, "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

const VOCAB_SET = new Set(VOCAB);

export async function enrichIndustries(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is required in environment.");
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  const limit = parseInt10(parseFlag("--limit"));
  const batchSize = parseInt10(parseFlag("--batch")) ?? DEFAULT_BATCH;
  const dryRun = hasFlag("--dry-run");

  // Need at least a one-liner or description to classify; otherwise the
  // model has nothing to work with and would just guess.
  let companies = await prisma.company.findMany({
    where: {
      isVerified: true,
      industry: null,
      OR: [
        { oneLiner: { not: null } },
        { description: { not: null } },
      ],
    },
    select: { id: true, name: true, oneLiner: true, description: true, tags: true },
    orderBy: { createdAt: "asc" },
  });
  if (limit !== null) companies = companies.slice(0, limit);

  console.log(
    `Found ${companies.length} verified companies missing industry (with usable description).${dryRun ? " (dry-run)" : ""}`
  );
  console.log(`Batch size: ${batchSize}, model: ${MODEL}`);

  const stats: Stats = {
    scanned: 0, classified: 0, unknown: 0, invalid: 0, tagsAdded: 0, errors: 0,
  };

  for (let i = 0; i < companies.length; i += batchSize) {
    const batch = companies.slice(i, i + batchSize) as CompanyRow[];
    stats.scanned += batch.length;

    try {
      const reply = await callClaude({
        apiKey,
        model: MODEL,
        system: SYSTEM,
        userContent: buildPrompt(batch),
        maxTokens: 1000,
      });
      const parsed = safeJsonParse(reply);
      if (!parsed) {
        stats.errors += batch.length;
        console.error(`  batch ${i}: model returned non-JSON, skipping.`);
        await sleep(500);
        continue;
      }

      for (const row of batch) {
        const industry = parsed[row.id];
        if (!industry || typeof industry !== "string") {
          stats.invalid++;
          continue;
        }
        if (industry === "Unknown") {
          stats.unknown++;
          continue;
        }
        if (!VOCAB_SET.has(industry)) {
          stats.invalid++;
          console.error(`  ${row.name}: model returned out-of-vocab "${industry}", skipping.`);
          continue;
        }

        const tag = tagFromTopic(industry);
        const additions: string[] = [];
        if (tag && !row.tags.includes(tag)) additions.push(tag);

        const update: Record<string, unknown> = { industry };
        if (additions.length > 0) {
          update.tags = mergeTags(row.tags, additions);
          stats.tagsAdded += additions.length;
        }
        stats.classified++;

        console.log(`  ${row.name}: ${industry}${additions.length > 0 ? ` +${additions.join(",")}` : ""}`);
        if (!dryRun) {
          await prisma.company.update({ where: { id: row.id }, data: update });
        }
      }
    } catch (err) {
      stats.errors += batch.length;
      console.error(`  batch ${i}: error — ${err instanceof Error ? err.message : err}`);
    }
    await sleep(400);
  }

  console.log("\n--- Run summary ---");
  console.log(`Scanned:           ${stats.scanned}`);
  console.log(`Classified:        ${stats.classified}`);
  console.log(`Unknown (model):   ${stats.unknown}`);
  console.log(`Invalid response:  ${stats.invalid}`);
  console.log(`Tag additions:     ${stats.tagsAdded}`);
  console.log(`Errors:            ${stats.errors}`);
  if (dryRun) console.log("(dry-run — no DB writes)");
  await prisma.$disconnect();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  enrichIndustries().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
