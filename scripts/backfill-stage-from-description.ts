import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";
import { CANONICAL_STAGES, type CanonicalStage } from "./_lib/stages.js";

// Free stage backfill — regex over existing description text for verified
// rows where stage is null. Captures the easy wins (rows whose description
// was scraped from Crunchbase-style sources and includes "Series A round" /
// "most recently a Series B" / "Seed Round" markers) at zero API cost.
//
// What it does NOT do: search the web. That's the Exa-backed sibling at
// scripts/backfill-stage-location-exa.ts (~$0.005/row). Run this script
// first to siphon off the free hits, then run Exa on the remainder.
//
// One-shot guard: tags `desc-stage-tried` (always on processed rows) and
// `desc-stage-enriched` (on hits) so a re-run doesn't re-scan the same rows.

interface Args {
  limit: number | null;
  dryRun: boolean;
  concurrency: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let limit: number | null = null;
  let dryRun = false;
  let concurrency = 8;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") limit = parseInt(argv[++i], 10);
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--concurrency") concurrency = parseInt(argv[++i], 10);
  }
  return { limit, dryRun, concurrency };
}

// Stage extraction patterns.
//
// Two tiers of confidence:
//   - Series [A-F]: tokenized "Series X" with a word boundary is a very
//     low-FP signal. False positives ("Series Capital", "World Series",
//     "Series of Books") are rare in startup descriptions. Match
//     unconditionally so we don't miss Crunchbase-style prose that
//     just lists "$X • Series B" without verb anchoring.
//   - Seed / Pre-Seed: high FP risk because lots of companies have
//     "seed" in their name or product ("Seedless", "Seedcamp"). Require
//     an explicit "Round" / "funding" / "stage" suffix.
const STRICT_PATTERNS: Array<{ re: RegExp; ordinalFn: (m: RegExpMatchArray) => CanonicalStage | null }> = [
  // Permissive Series [A-F] — token-bounded so we don't catch substrings.
  { re: /\bSeries\s+([A-F])(?:\s*\+)?\b/i, ordinalFn: (m) => normalizeStage(`Series ${m[1]}`) },
  // Seed: require Round / funding / stage / financing context.
  { re: /\b(Seed)\s+(?:Round|funding|stage|financing|investment)\b/i, ordinalFn: () => "Seed" as CanonicalStage },
  // Pre-Seed: same.
  { re: /\bPre[-\s]Seed\s+(?:Round|funding|stage|financing|investment)?\b/i, ordinalFn: () => "Pre-Seed" as CanonicalStage },
];

function normalizeStage(raw: string): CanonicalStage | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  // Pre-Seed normalization
  if (/^pre[-\s]seed/i.test(cleaned)) return "Pre-Seed" as CanonicalStage;
  if (/^seed\s+round/i.test(cleaned) || /^seed\s+funding/i.test(cleaned)) return "Seed" as CanonicalStage;
  if (/^seed$/i.test(cleaned)) return "Seed" as CanonicalStage;
  const m = cleaned.match(/^Series\s+([A-F])\s*\+?$/i);
  if (m) {
    const letter = m[1].toUpperCase();
    const stage = `Series ${letter}` as CanonicalStage;
    return (CANONICAL_STAGES as readonly string[]).includes(stage) ? stage : null;
  }
  return null;
}

// Extract the highest-ordinal stage from a description blob. If multiple
// rounds are mentioned ("raised a Series A in 2020 ... most recently a
// Series C in 2024"), pick the latest letter — that's the company's
// current stage.
function extractStage(description: string): CanonicalStage | null {
  let best: CanonicalStage | null = null;
  let bestOrd = -1;
  const STAGE_ORDINALS: Record<string, number> = {
    "Pre-Seed": 0,
    "Seed": 1,
    "Series A": 2,
    "Series B": 3,
    "Series C": 4,
    "Series D": 5,
    "Series E": 6,
    "Series F": 7,
  };
  for (const { re, ordinalFn } of STRICT_PATTERNS) {
    const matches = description.matchAll(new RegExp(re.source, re.flags + "g"));
    for (const m of matches) {
      const stage = ordinalFn(m);
      if (!stage) continue;
      const ord = STAGE_ORDINALS[stage] ?? -1;
      if (ord > bestOrd) {
        bestOrd = ord;
        best = stage;
      }
    }
  }
  return best;
}

async function main() {
  const { limit, dryRun, concurrency } = parseArgs();

  const rows = await prisma.company.findMany({
    where: {
      isVerified: true,
      stage: null,
      description: { not: null },
      NOT: { tags: { has: "desc-stage-tried" } },
    },
    select: { id: true, name: true, description: true, tags: true },
    ...(limit ? { take: limit } : {}),
  });

  console.log(`[desc-backfill] scanning ${rows.length} rows (limit=${limit ?? "none"}, dry-run=${dryRun})`);

  let hits = 0;
  let writes = 0;
  const hitsByStage = new Map<string, number>();
  const startedAt = Date.now();
  let processed = 0;

  const writeOne = async (row: typeof rows[number]): Promise<void> => {
    const stage = extractStage(row.description!);
    const baseTags = Array.isArray(row.tags) ? row.tags : [];
    const newTags = new Set<string>(baseTags);
    newTags.add("desc-stage-tried");
    if (stage) {
      hits++;
      hitsByStage.set(stage, (hitsByStage.get(stage) ?? 0) + 1);
      newTags.add("desc-stage-enriched");
    }
    if (!dryRun) {
      await prisma.company.update({
        where: { id: row.id },
        data: stage
          ? { stage, tags: [...newTags] }
          : { tags: [...newTags] },
      });
      writes++;
    }
    processed++;
    if (processed % 500 === 0) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      const rate = (processed / ((Date.now() - startedAt) / 1000)).toFixed(0);
      console.log(`[desc-backfill] ${processed}/${rows.length} — ${hits} hits (${elapsed}s, ${rate}/s)`);
    }
  };

  // Run with limited concurrency.
  const queue = [...rows];
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const r = queue.shift();
      if (!r) return;
      await writeOne(r);
    }
  });
  await Promise.all(workers);

  console.log();
  console.log(`Scanned:     ${rows.length}`);
  console.log(`Stage hits:  ${hits} (${((hits / rows.length) * 100).toFixed(1)}%)`);
  console.log(`DB writes:   ${writes}`);
  console.log();
  console.log("Hit distribution by stage:");
  for (const [stage, count] of [...hitsByStage.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${stage.padEnd(15)} ${count}`);
  }

  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
