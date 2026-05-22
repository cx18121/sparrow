import "dotenv/config";
import { prisma } from "./_lib/prisma.js";
import { detectExaJunk } from "./_lib/exa-junk-filter.js";

// Phase 1 of exa-discovery quality cleanup.
//
// Walks every isVerified=true row sourced from `exa-discovery` and applies
// the shared regex filter (scripts/_lib/exa-junk-filter.ts) to flag
// non-startups. Matches get `isVerified: false` + the `exa-junk-regex` tag
// (idempotent — re-runs skip already-tagged rows).
//
// Default mode is DRY: prints stats + a 20-row sample of what would be
// demoted. Pass `--apply` to actually write. Pass `--limit N` to cap.

interface Match {
  id: string;
  name: string;
  domain: string | null;
  pattern: string;
  evidence: string;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx !== -1 ? parseInt(argv[limitIdx + 1], 10) : 0;

  const rows = await prisma.company.findMany({
    where: { source: "exa-discovery", isVerified: true, NOT: { tags: { has: "exa-junk-regex" } } },
    select: { id: true, name: true, domain: true, description: true },
    ...(limit > 0 ? { take: limit } : {}),
  });
  console.log(`Scanning ${rows.length} exa-discovery verified rows (apply=${apply})`);

  const byPattern = new Map<string, number>();
  const matches: Match[] = [];

  for (const r of rows) {
    const hit = detectExaJunk({ name: r.name, domain: r.domain, description: r.description });
    if (!hit) continue;
    byPattern.set(hit.pattern, (byPattern.get(hit.pattern) ?? 0) + 1);
    matches.push({ id: r.id, name: r.name, domain: r.domain, pattern: hit.pattern, evidence: `[${hit.field}] ${hit.matched}` });
  }

  console.log(`\nMatched ${matches.length} of ${rows.length} (${((matches.length / rows.length) * 100).toFixed(1)}%)`);
  console.log("\nBy pattern:");
  for (const [pat, n] of [...byPattern.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pat.padEnd(28)} ${n}`);
  }

  console.log("\nSample (20 random):");
  const sample = matches.slice().sort(() => Math.random() - 0.5).slice(0, 20);
  for (const s of sample) {
    console.log(`  [${s.pattern}] ${s.name} (${s.domain ?? "-"}) → ${s.evidence}`);
  }

  if (!apply) {
    console.log("\nDRY mode — no writes. Re-run with --apply to demote.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nApplying isVerified=false + tag 'exa-junk-regex' to ${matches.length} rows...`);
  let written = 0;
  for (const m of matches) {
    await prisma.company.update({
      where: { id: m.id },
      data: {
        isVerified: false,
        tags: { push: "exa-junk-regex" },
      },
    });
    written++;
    if (written % 500 === 0) console.log(`  ${written}/${matches.length}`);
  }
  console.log(`Done. ${written} rows demoted.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
