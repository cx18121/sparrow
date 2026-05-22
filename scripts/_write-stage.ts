import "dotenv/config";
import { prisma } from "./_lib/prisma.js";
import { CANONICAL_STAGES, type CanonicalStage } from "./_lib/stages.js";

// Helper script — called by subagents enriching stage data via WebSearch.
//
// Usage:
//   npx tsx scripts/_write-stage.ts <id> <stage|none> [evidence]
//
//   <id>       Prisma Company.id (cuid)
//   <stage>    "none" | "Pre-Seed" | "Seed" | "Series A" .. "Series F" |
//              "Series A+" .. "Series F+"
//   [evidence] optional one-line evidence string (logged but not stored)
//
// Always tags the row with `cc-stage-tried` so re-runs skip it. If stage
// is a canonical value, also tags `cc-stage-enriched` and writes the
// stage column. If stage is "none" or unrecognized, only the tried tag
// is written (one-shot).

async function main() {
  const [id, stageArg, ...rest] = process.argv.slice(2);
  if (!id || !stageArg) {
    console.error("usage: _write-stage.ts <id> <stage|none> [evidence]");
    process.exit(1);
  }
  const evidence = rest.join(" ");

  const row = await prisma.company.findUnique({
    where: { id },
    select: { tags: true, stage: true, name: true },
  });
  if (!row) {
    console.error(`row ${id} not found`);
    process.exit(1);
  }
  const tags = new Set<string>(row.tags ?? []);
  tags.add("cc-stage-tried");

  let stageToWrite: CanonicalStage | null = null;
  const stageClean = stageArg.trim();
  if (stageClean.toLowerCase() !== "none" && stageClean !== "") {
    if ((CANONICAL_STAGES as readonly string[]).includes(stageClean)) {
      stageToWrite = stageClean as CanonicalStage;
      tags.add("cc-stage-enriched");
    } else {
      console.error(`unrecognized stage "${stageClean}" — valid: ${(CANONICAL_STAGES as readonly string[]).join(", ")}`);
      // Still tag tried so we don't keep re-polling this row.
      await prisma.company.update({ where: { id }, data: { tags: [...tags] } });
      process.exit(2);
    }
  }

  // If the row already had a stage (somehow), don't overwrite — just tag.
  const data: { tags: string[]; stage?: CanonicalStage } = { tags: [...tags] };
  if (stageToWrite && !row.stage) data.stage = stageToWrite;

  await prisma.company.update({ where: { id }, data });
  console.log(`OK ${row.name} → ${stageToWrite ?? "tried-only"}${evidence ? ` (${evidence})` : ""}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
