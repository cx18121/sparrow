import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { mergeTags, tagFromTopic } from "./_lib/tags.js";
import { callClaude } from "../server/lib/ai/anthropic.js";

// Sector + Tech are the two filter axes the Audience UI exposes. They are
// independent — a company can have both, one, or neither. Most rows in the
// DB have at most one because the original `industry` string maps to a
// single canonical tag (vertical:* OR tech:*, not both).
//
// This script fills missing axes per company:
//   1. Pass 1 (free, deterministic): tagFromTopic(industry) returns one
//      namespaced tag — used to fill whichever axis it falls into.
//   2. Pass 2 (Claude Haiku): for whatever axis is still missing, the model
//      classifies on both axes using name + industry + oneLiner + description.
//      Each axis may resolve to a canonical value, "None" (genuinely doesn't
//      apply, e.g., pure consumer brand has no tech), or "Unknown" (model
//      gives up).
//
// Company.industry is left untouched — the raw label often carries more
// specificity than the canonical bucket. Tags are additive.
//
// Cost: ~$0.30 over ~10k rows on Haiku 4.5, batches of 15.
//
// Usage:
//   npx tsx scripts/reclassify-industry-strings.ts                # full run
//   npx tsx scripts/reclassify-industry-strings.ts --limit 100    # cap rows
//   npx tsx scripts/reclassify-industry-strings.ts --dry-run      # log only
//   npx tsx scripts/reclassify-industry-strings.ts --batch 15     # rows per call

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_BATCH = 15;

// These MUST stay in sync with VERTICAL_DEFINITIONS / TECH_DEFINITIONS keys
// in scripts/_lib/tags.ts. tagFromTopic uses those as canonical.
const VERTICAL_VOCAB = [
  "fintech", "health", "biotech", "education", "legal", "realestate",
  "govtech", "agriculture", "climate", "energy", "industrial", "logistics",
  "ecommerce", "gaming", "sports", "travel", "food", "fashion", "beauty",
  "pets", "parenting", "dating", "automotive", "defense",
  "marketing", "sales", "hr", "customer-support", "productivity",
  "design", "content",
];
const TECH_VOCAB = [
  "ai", "crypto", "devtools", "devops", "infrastructure", "security",
  "data", "analytics", "nocode", "api", "web", "mobile", "iot", "xr",
  "hardware", "robotics", "automation", "opensource",
  "adtech", "communication", "search",
];
const VERTICAL_SET = new Set(VERTICAL_VOCAB);
const TECH_SET = new Set(TECH_VOCAB);

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
  alreadyComplete: number;
  detVertical: number;
  detTech: number;
  llmVertical: number;
  llmTech: number;
  llmNoneVertical: number;
  llmNoneTech: number;
  llmUnknownVertical: number;
  llmUnknownTech: number;
  llmInvalid: number;
  errors: number;
}

const SYSTEM = `You classify each company on TWO independent axes.

VERTICAL — the industry the company serves. Pick exactly one of:
${VERTICAL_VOCAB.join(", ")}
Or "None" if the company has no specific vertical (e.g., horizontal devtools, pure AI lab, generic SaaS).
Or "Unknown" if there is not enough info to tell.

TECH — the technology that defines the product. Pick exactly one of:
${TECH_VOCAB.join(", ")}
Or "None" if the company has no defining tech (e.g., pure consumer brand: fashion, beauty, food without a tech angle).
Or "Unknown" if there is not enough info to tell.

A company can have both, one, or neither. Examples:
  AI startup serving healthcare → {"vertical":"health","tech":"ai"}
  Anthropic (pure AI lab)        → {"vertical":"None","tech":"ai"}
  Stripe (fintech with API)      → {"vertical":"fintech","tech":"api"}
  Allbirds (fashion brand)       → {"vertical":"fashion","tech":"None"}
  Generic CRM SaaS               → {"vertical":"None","tech":"None"}

Output rules:
1. Return strict JSON. Object mapping each input id to an object with "vertical" and "tech" keys.
2. Both keys MUST be present per id.
3. Do not invent vocab. Do not add commentary. Do not wrap in markdown.

Example output:
{"abc123": {"vertical":"fintech","tech":"api"}, "def456": {"vertical":"None","tech":"ai"}}`;

interface CompanyRow {
  id: string;
  name: string;
  industry: string | null;
  oneLiner: string | null;
  description: string | null;
  tags: string[];
}

function needsVertical(tags: string[]): boolean {
  return !tags.some(t => t.startsWith("vertical:"));
}
function needsTech(tags: string[]): boolean {
  return !tags.some(t => t.startsWith("tech:"));
}

function buildPrompt(rows: CompanyRow[]): string {
  const lines = rows.map(r => {
    const parts = [`name=${r.name}`];
    if (r.industry) parts.push(`industry=${r.industry}`);
    if (r.oneLiner) parts.push(`one-liner=${r.oneLiner.slice(0, 120)}`);
    else if (r.description) parts.push(`description=${r.description.slice(0, 200)}`);
    return `${r.id} | ${parts.join(" | ")}`;
  });
  return `Classify each company on the vertical and tech axes. Return JSON only.\n\n${lines.join("\n")}`;
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/g, "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch { return null; }
}

interface Resolution {
  vertical: string | null;  // canonical key (no namespace) or null if unset
  tech: string | null;
  verticalIsNone: boolean;  // model said "None" — record nothing
  techIsNone: boolean;
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

  const companies = await prisma.company.findMany({
    where: { isVerified: true },
    select: {
      id: true, name: true, industry: true,
      oneLiner: true, description: true, tags: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const candidates = companies.filter(c =>
    needsVertical(c.tags) || needsTech(c.tags)
  ) as CompanyRow[];
  const scoped = limit !== null ? candidates.slice(0, limit) : candidates;

  console.log(
    `Found ${scoped.length} verified companies missing vertical and/or tech tag.${dryRun ? " (dry-run)" : ""}`
  );
  console.log(`Batch size: ${batchSize}, model: ${MODEL}`);

  const stats: Stats = {
    scanned: 0, alreadyComplete: 0,
    detVertical: 0, detTech: 0,
    llmVertical: 0, llmTech: 0,
    llmNoneVertical: 0, llmNoneTech: 0,
    llmUnknownVertical: 0, llmUnknownTech: 0,
    llmInvalid: 0, errors: 0,
  };

  for (let i = 0; i < scoped.length; i += batchSize) {
    const batch = scoped.slice(i, i + batchSize);
    stats.scanned += batch.length;

    try {
      // Pass 1: deterministic. tagFromTopic(industry) gives at most one
      // canonical namespaced tag — fills the matching axis if missing.
      const remaining: { row: CompanyRow; missingV: boolean; missingT: boolean }[] = [];
      const detUpdates: { id: string; tags: string[]; tag: string; axis: "v" | "t" }[] = [];
      for (const row of batch) {
        let missingV = needsVertical(row.tags);
        let missingT = needsTech(row.tags);
        let workingTags = row.tags;
        if (row.industry) {
          const tag = tagFromTopic(row.industry);
          if (tag?.startsWith("vertical:") && missingV) {
            workingTags = mergeTags(workingTags, [tag]);
            missingV = false;
            stats.detVertical++;
            detUpdates.push({ id: row.id, tags: workingTags, tag, axis: "v" });
            console.log(`  [det] ${row.name}: industry="${row.industry}" -> +${tag}`);
          } else if (tag?.startsWith("tech:") && missingT) {
            workingTags = mergeTags(workingTags, [tag]);
            missingT = false;
            stats.detTech++;
            detUpdates.push({ id: row.id, tags: workingTags, tag, axis: "t" });
            console.log(`  [det] ${row.name}: industry="${row.industry}" -> +${tag}`);
          }
        }
        if (missingV || missingT) {
          remaining.push({ row: { ...row, tags: workingTags }, missingV, missingT });
        }
      }
      if (!dryRun) {
        for (const upd of detUpdates) {
          await prisma.company.update({ where: { id: upd.id }, data: { tags: upd.tags } });
        }
      }
      if (remaining.length === 0) continue;

      // Pass 2: Claude. Ask for both axes; we only apply the ones we still need.
      const reply = await callClaude({
        apiKey,
        model: MODEL,
        system: SYSTEM,
        userContent: buildPrompt(remaining.map(r => r.row)),
        maxTokens: 1800,
      });
      const parsed = safeJsonParse(reply);
      if (!parsed) {
        stats.errors += remaining.length;
        console.error(`  batch ${i}: model returned non-JSON, skipping.`);
        await sleep(500);
        continue;
      }

      for (const { row, missingV, missingT } of remaining) {
        const entry = parsed[row.id];
        if (!entry || typeof entry !== "object") { stats.llmInvalid++; continue; }
        const r = entry as { vertical?: unknown; tech?: unknown };
        const v = typeof r.vertical === "string" ? r.vertical : null;
        const t = typeof r.tech === "string" ? r.tech : null;

        const newTags: string[] = [];

        if (missingV) {
          if (v === "None") stats.llmNoneVertical++;
          else if (v === "Unknown" || v === null) stats.llmUnknownVertical++;
          else if (VERTICAL_SET.has(v)) {
            newTags.push(`vertical:${v}`);
            stats.llmVertical++;
          } else stats.llmInvalid++;
        }
        if (missingT) {
          if (t === "None") stats.llmNoneTech++;
          else if (t === "Unknown" || t === null) stats.llmUnknownTech++;
          else if (TECH_SET.has(t)) {
            newTags.push(`tech:${t}`);
            stats.llmTech++;
          } else stats.llmInvalid++;
        }

        if (newTags.length === 0) continue;

        console.log(`  ${row.name}: +${newTags.join(", +")}`);
        if (!dryRun) {
          await prisma.company.update({
            where: { id: row.id },
            data: { tags: mergeTags(row.tags, newTags) },
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
  console.log(`Scanned:                          ${stats.scanned}`);
  console.log(`Deterministic vertical hits:      ${stats.detVertical}`);
  console.log(`Deterministic tech hits:          ${stats.detTech}`);
  console.log(`LLM vertical hits:                ${stats.llmVertical}`);
  console.log(`LLM tech hits:                    ${stats.llmTech}`);
  console.log(`LLM said vertical=None:           ${stats.llmNoneVertical}`);
  console.log(`LLM said tech=None:               ${stats.llmNoneTech}`);
  console.log(`LLM said vertical=Unknown:        ${stats.llmUnknownVertical}`);
  console.log(`LLM said tech=Unknown:            ${stats.llmUnknownTech}`);
  console.log(`LLM invalid (out-of-vocab/etc):   ${stats.llmInvalid}`);
  console.log(`Errors (batch failed):            ${stats.errors}`);
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
