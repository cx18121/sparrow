import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "./_lib/prisma.js";

// ── Patterns that indicate garbage in text fields ────────────────────────────

// For SHORT fields (industry, stage, location) — aggressive matching is fine
// because these should be single-concept values, not prose.
const SHORT_FIELD_JOB_SIGNALS = [
  "engineer", "developer", "designer", "manager", "scientist", "researcher",
  "analyst", "executive", "director", "president", "officer",
  // "intern" omitted — false-positive on "international"
  // "lead" omitted — false-positive on "Cleveland" etc.
  // "swe" omitted — false-positive on "Sweden"/"Swedish"
  "architect", "specialist", "consultant", "associate", "coordinator",
  "recruiter", "advisor", "strategist", "full stack", "fullstack", "backend",
  "frontend", "devops",
];

// For LONG fields (oneLiner, description) — only catch strings that are
// clearly job listings, not legitimate company descriptions that happen to
// mention hiring or specialists.
const LONG_FIELD_JOB_SIGNALS = [
  "we are looking for",
  "we're looking for",
  "looking for a senior",
  "looking for an experienced",
  "join our team as",
  "open role",
  "open position",
  "years of experience required",
  "requirements:",
  "responsibilities:",
  "must have experience",
];

const SALARY_SIGNALS = [/\$\d+[k-]/i, /€\d+/i, /\d+k\+/i, /salary range/i];

const KNOWN_STAGES = new Set([
  "pre-seed", "preseed", "seed", "series a", "series b", "series c",
  "series d", "series e", "series f", "growth", "late", "late stage",
  "ipo", "public", "acquired", "stealth", "early", "early stage",
]);

function isShortFieldGarbage(val: string): boolean {
  const lower = val.toLowerCase().trim();
  return (
    SHORT_FIELD_JOB_SIGNALS.some(s => lower.includes(s)) ||
    SALARY_SIGNALS.some(r => r.test(val)) ||
    lower.startsWith("http") ||
    lower.startsWith("www.")
  );
}

function isLongFieldGarbage(val: string): boolean {
  const lower = val.toLowerCase();
  return (
    LONG_FIELD_JOB_SIGNALS.some(s => lower.includes(s)) ||
    SALARY_SIGNALS.some(r => r.test(val))
  );
}

async function audit() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Company data audit");
  console.log("═══════════════════════════════════════════════════════════\n");

  // ── 1. Industry garbage ────────────────────────────────────────────────────
  const industries = await prisma.company.groupBy({
    by: ["industry"],
    where: { isVerified: true, industry: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: "asc" } },
  });

  // Multi-word compound categories that contain a signal word but are valid
  // (e.g. "Developer Tools", "consumer internet media"). Only flag single-word
  // or clearly garbage values.
  const KNOWN_GOOD_INDUSTRIES = new Set([
    "developer tools", "consumer internet media", "consumer goods",
    "financial services", "professional services",
  ]);
  const badIndustries = industries.filter(r => {
    const v = r.industry!.toLowerCase().trim();
    return !KNOWN_GOOD_INDUSTRIES.has(v) && isShortFieldGarbage(v);
  });
  const locationIndustries = industries.filter(r => {
    const v = r.industry!.toLowerCase().trim();
    return !isShortFieldGarbage(v) && (
      v === "india" || v === "europe" || v === "us" || v === "uk" ||
      v === "apac" || v === "emea" || v === "global" || v === "remote" ||
      v === "distributed" || /^\d+$/.test(v)
    );
  });

  console.log(`INDUSTRY (${industries.length} distinct values)`);
  if (badIndustries.length) {
    console.log(`  Garbage strings (${badIndustries.length}):`);
    for (const r of badIndustries) console.log(`    [${r._count.id}] ${r.industry}`);
  }
  if (locationIndustries.length) {
    console.log(`  Location strings stored as industry (${locationIndustries.length}):`);
    for (const r of locationIndustries) console.log(`    [${r._count.id}] ${r.industry}`);
  }
  if (!badIndustries.length && !locationIndustries.length) console.log("  ✓ Clean");

  // ── 2. Stage garbage ──────────────────────────────────────────────────────
  const stages = await prisma.company.groupBy({
    by: ["stage"],
    where: { isVerified: true, stage: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: "asc" } },
  });

  const badStages = stages.filter(r => {
    const v = r.stage!.toLowerCase().trim();
    return !KNOWN_STAGES.has(v) || isShortFieldGarbage(v);
  });

  console.log(`\nSTAGE (${stages.length} distinct values)`);
  if (badStages.length) {
    console.log(`  Unknown/garbage values (${badStages.length}):`);
    for (const r of badStages) console.log(`    [${r._count.id}] ${r.stage}`);
  } else {
    console.log("  ✓ Clean");
  }

  // ── 3. Remaining location garbage (non-null, not already cleaned) ──────────
  const locations = await prisma.company.findMany({
    where: {
      isVerified: true,
      location: { not: null },
      region: null, // region was nulled by normalizeRegion → location was garbage
    },
    select: { location: true },
  });
  // Sample a few that look like garbage
  const garbageLocations = locations
    .filter(r => isShortFieldGarbage(r.location!))
    .slice(0, 10);

  console.log(`\nLOCATION (companies with location but null region: ${locations.length})`);
  if (garbageLocations.length) {
    console.log(`  Sample garbage strings still in location field:`);
    for (const r of garbageLocations) console.log(`    ${r.location}`);
  } else {
    console.log("  ✓ No obvious garbage");
  }

  // ── 4. oneLiner garbage ───────────────────────────────────────────────────
  const garbageOneLiner = await prisma.company.findMany({
    where: {
      isVerified: true,
      oneLiner: { not: null },
    },
    select: { id: true, name: true, oneLiner: true },
  });

  const badOneLiner = garbageOneLiner.filter(r => isLongFieldGarbage(r.oneLiner!));
  console.log(`\nONE-LINER`);
  if (badOneLiner.length) {
    console.log(`  Garbage strings (${badOneLiner.length}):`);
    for (const r of badOneLiner.slice(0, 15))
      console.log(`    [${r.name}] ${r.oneLiner?.slice(0, 80)}`);
    if (badOneLiner.length > 15) console.log(`    … and ${badOneLiner.length - 15} more`);
  } else {
    console.log("  ✓ Clean");
  }

  // ── 5. Tags with no namespace (legacy / unrecognized) ─────────────────────
  const tagResult = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
    SELECT tag, COUNT(*)::bigint AS count
    FROM (
      SELECT unnest(tags) AS tag
      FROM "Company"
      WHERE "isVerified" = true
    ) t
    WHERE tag NOT LIKE '%:%'
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 30
  `;

  console.log(`\nTAGS WITHOUT NAMESPACE (legacy unnamespaced tags)`);
  if (tagResult.length) {
    for (const r of tagResult) console.log(`    [${r.count}] ${r.tag}`);
  } else {
    console.log("  ✓ None");
  }

  // ── 6. Summary ─────────────────────────────────────────────────────────────
  const totalGarbage =
    badIndustries.reduce((s, r) => s + r._count.id, 0) +
    locationIndustries.reduce((s, r) => s + r._count.id, 0) +
    badOneLiner.length;

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  Total companies with fixable garbage data: ~${totalGarbage}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  return { badIndustries, locationIndustries, badStages, badOneLiner };
}

async function clean(findings: Awaited<ReturnType<typeof audit>>) {
  const { badIndustries, locationIndustries, badStages, badOneLiner } = findings;
  let fixed = 0;

  // Clear garbage industry strings
  const badIndustryVals = [
    ...badIndustries.map(r => r.industry!),
    ...locationIndustries.map(r => r.industry!),
  ];
  if (badIndustryVals.length) {
    const result = await prisma.company.updateMany({
      where: { industry: { in: badIndustryVals } },
      data: { industry: null },
    });
    console.log(`  Cleared industry on ${result.count} companies`);
    fixed += result.count;
  }

  // Clear garbage stage strings (only fully unknown ones, not stage variants)
  const badStageVals = badStages
    .filter(r => isShortFieldGarbage(r.stage!))
    .map(r => r.stage!);
  if (badStageVals.length) {
    const result = await prisma.company.updateMany({
      where: { stage: { in: badStageVals } },
      data: { stage: null },
    });
    console.log(`  Cleared stage on ${result.count} companies`);
    fixed += result.count;
  }

  // Clear garbage oneLiner strings
  if (badOneLiner.length) {
    const ids = badOneLiner.map(r => r.id);
    const result = await prisma.company.updateMany({
      where: { id: { in: ids } },
      data: { oneLiner: null },
    });
    console.log(`  Cleared oneLiner on ${result.count} companies`);
    fixed += result.count;
  }

  // Null out location strings that look like job titles (region already null).
  // Select in batches to avoid giant IN clauses.
  const garbageLocationCompanies = await prisma.company.findMany({
    where: { location: { not: null }, region: null },
    select: { id: true, location: true },
  });
  const garbageLocationIds = garbageLocationCompanies
    .filter(r => isShortFieldGarbage(r.location!))
    .map(r => r.id);
  if (garbageLocationIds.length) {
    const result = await prisma.company.updateMany({
      where: { id: { in: garbageLocationIds } },
      data: { location: null },
    });
    console.log(`  Cleared garbage location strings on ${result.count} companies`);
    fixed += result.count;
  }

  console.log(`\nTotal rows cleaned: ${fixed}`);
}

async function main() {
  const findings = await audit();
  const total =
    findings.badIndustries.reduce((s, r) => s + r._count.id, 0) +
    findings.locationIndustries.reduce((s, r) => s + r._count.id, 0) +
    findings.badOneLiner.length;

  if (total === 0) {
    console.log("Nothing to clean.");
    return;
  }

  if (process.argv.includes("--fix")) {
    console.log("\nCleaning...");
    await clean(findings);
  } else {
    console.log('Run with --fix to apply these cleanups.\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().finally(() => prisma.$disconnect()).catch(console.error);
}
