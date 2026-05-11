import "dotenv/config";
import { prisma } from "./_lib/prisma.js";

// Print the (source, stage) distribution for every Company row, including
// null stages. Lets us see two things:
//   1. Which sources have no stage data at all (stage: null) — those rows
//      get hidden the moment a user picks any stage in the wizard filter.
//   2. Which sources are bunching everything into "Series B" (a16z, Accel)
//      or "Series A" (YC) because of lossy normalizers, even when the source
//      page actually distinguished later rounds.
//
// Run: tsx scripts/audit-stages.ts
//
// Honors --verified-only to mirror the wizard's audience query (which adds
// isVerified: true). Default prints both verified and unverified rows so the
// scratchpad sources (hn-hiring, gregslist, startups-gallery) are visible.

const VERIFIED_ONLY = process.argv.includes("--verified-only");

interface Row {
  source: string | null;
  stage: string | null;
  count: number;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

async function main() {
  const where = VERIFIED_ONLY ? { isVerified: true } : {};
  const groups = await prisma.company.groupBy({
    by: ["source", "stage"],
    where,
    _count: { _all: true },
    orderBy: [{ source: "asc" }, { stage: "asc" }],
  });

  const rows: Row[] = groups.map((g) => ({
    source: g.source,
    stage: g.stage,
    count: g._count._all,
  }));

  // Group by source for readable output.
  const bySource = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.source ?? "(no source)";
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(r);
  }

  const colSource = Math.max(12, ...[...bySource.keys()].map((s) => s.length));
  const colStage = 14;
  const colCount = 8;

  console.log(
    `Stage distribution (${VERIFIED_ONLY ? "verified only" : "all rows"})`
  );
  console.log("=".repeat(colSource + colStage + colCount + 6));
  console.log(
    `${pad("source", colSource)}  ${pad("stage", colStage)}  ${pad("count", colCount)}`
  );
  console.log("-".repeat(colSource + colStage + colCount + 6));

  const sources = [...bySource.keys()].sort();
  let grandTotal = 0;
  let grandNullStage = 0;
  for (const source of sources) {
    const sourceRows = bySource.get(source)!;
    sourceRows.sort((a, b) => b.count - a.count);
    const sourceTotal = sourceRows.reduce((acc, r) => acc + r.count, 0);
    const sourceNullStage = sourceRows
      .filter((r) => r.stage == null)
      .reduce((acc, r) => acc + r.count, 0);
    grandTotal += sourceTotal;
    grandNullStage += sourceNullStage;
    for (const r of sourceRows) {
      console.log(
        `${pad(source, colSource)}  ${pad(r.stage ?? "(null)", colStage)}  ${pad(fmt(r.count), colCount)}`
      );
    }
    if (sourceNullStage > 0) {
      const pct = ((sourceNullStage / sourceTotal) * 100).toFixed(0);
      console.log(
        `${pad("", colSource)}  ${pad("→ null:", colStage)}  ${pad(`${pct}%`, colCount)}`
      );
    }
    console.log("-".repeat(colSource + colStage + colCount + 6));
  }

  console.log(`\nTotal rows: ${fmt(grandTotal)}`);
  console.log(
    `Rows with stage = null: ${fmt(grandNullStage)} (${((grandNullStage / Math.max(1, grandTotal)) * 100).toFixed(1)}%)`
  );

  // Surface the late-stage roll-up explicitly — these are the buckets that
  // the lossy a16z/Accel/YC normalizers either collapse together or drop
  // entirely. If "Series C+" or "Growth" count is suspiciously low next to
  // the early-stage buckets, the fix is in the mappers, not the sources.
  const stageRollup = new Map<string, number>();
  for (const r of rows) {
    if (!r.stage) continue;
    const key = r.stage;
    stageRollup.set(key, (stageRollup.get(key) ?? 0) + r.count);
  }
  const stages = [...stageRollup.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\nStage roll-up (across all sources):`);
  for (const [stage, count] of stages) {
    console.log(`  ${pad(stage, colStage)}  ${fmt(count)}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
