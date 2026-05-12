import "dotenv/config";
import { prisma } from "./_lib/prisma.js";
import {
  STAGE_INFERRED_SIGNAL,
  defaultStageRuleFromTags,
} from "./_lib/stage-defaults.js";

// One-shot backfill that applies the stage-inference rules from
// scripts/_lib/stage-defaults.ts to existing Company rows with stage=null.
// Mirrors what upsertCompany now does for new ingest, but reaches the
// ~6,300 rows already in the DB that won't be re-scraped soon.
//
// Run: tsx scripts/backfill-stage-defaults.ts [--dry-run] [--verified-only]
//
// --dry-run: print what would change, don't write.
// --verified-only: mirror the wizard query (isVerified: true) so we audit
// only rows that actually surface to users.

const DRY_RUN = process.argv.includes("--dry-run");
const VERIFIED_ONLY = process.argv.includes("--verified-only");

interface BackfillResult {
  scanned: number;
  inferred: number;
  byRule: Map<string, { stage: string; count: number }>;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main(): Promise<BackfillResult> {
  const where = VERIFIED_ONLY
    ? { isVerified: true, stage: null }
    : { stage: null };

  const candidates = await prisma.company.findMany({
    where,
    select: { id: true, domain: true, tags: true },
  });

  console.log(
    `Scanning ${candidates.length.toLocaleString()} null-stage rows` +
      (VERIFIED_ONLY ? " (verified only)" : "") +
      (DRY_RUN ? " [dry-run]" : "") +
      "...\n",
  );

  const byRule = new Map<string, { stage: string; count: number }>();
  let inferred = 0;

  for (const c of candidates) {
    const rule = defaultStageRuleFromTags(c.tags);
    if (!rule) continue;

    inferred++;
    const key = rule.matchTag;
    const entry = byRule.get(key) ?? { stage: rule.stage, count: 0 };
    entry.count++;
    byRule.set(key, entry);

    if (DRY_RUN) continue;

    // Skip if the inferred-signal tag is already present (defensive — the
    // findMany filter on stage=null rules out the normal path, but a row
    // with the marker but null stage would be a corrupt state, leave it).
    const nextTags = c.tags.includes(STAGE_INFERRED_SIGNAL)
      ? c.tags
      : [...c.tags, STAGE_INFERRED_SIGNAL];

    await prisma.company.update({
      where: { id: c.id },
      data: { stage: rule.stage, tags: nextTags },
    });
  }

  // Per-rule breakdown — useful for spot-checking that no rule has a
  // weirdly low / high impact (e.g. if investor:battery only matches
  // 5 rows, the adapter probably didn't run; if it matches 5000, we may
  // have over-applied the tag earlier).
  const colTag = Math.max(28, ...[...byRule.keys()].map(s => s.length));
  const colStage = 14;
  const colCount = 8;

  console.log(`Rule application:`);
  console.log("=".repeat(colTag + colStage + colCount + 6));
  console.log(
    `${pad("rule matchTag", colTag)}  ${pad("→ stage", colStage)}  ${pad("count", colCount)}`,
  );
  console.log("-".repeat(colTag + colStage + colCount + 6));

  const sortedRules = [...byRule.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [tag, info] of sortedRules) {
    console.log(
      `${pad(tag, colTag)}  ${pad(info.stage, colStage)}  ${pad(info.count.toLocaleString(), colCount)}`,
    );
  }
  console.log("-".repeat(colTag + colStage + colCount + 6));

  const pct = candidates.length === 0
    ? "0"
    : ((inferred / candidates.length) * 100).toFixed(1);
  console.log(
    `\nScanned: ${candidates.length.toLocaleString()} | ` +
      `Inferred: ${inferred.toLocaleString()} (${pct}% of scan)`,
  );

  if (DRY_RUN) {
    console.log(`\n[dry-run] No writes performed. Re-run without --dry-run to apply.`);
  } else {
    console.log(`\nDone. ${inferred.toLocaleString()} rows updated.`);
  }

  return { scanned: candidates.length, inferred, byRule };
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
